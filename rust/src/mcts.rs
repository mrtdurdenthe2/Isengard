use std::collections::HashMap;

use crate::engine::WeightMode;
use crate::types::{Affix, ItemProfile, Mod, TargetMod};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetMode {
    AllowExtra,
    Exact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Rarity {
    Normal,
    Magic,
    Rare,
}

#[derive(Debug, Clone)]
struct RolledMod {
    mod_id: String,
    name: String,
    affix: Affix,
}

#[derive(Debug, Clone)]
struct ItemState {
    item_level: u32,
    rarity: Rarity,
    prefixes: Vec<RolledMod>,
    suffixes: Vec<RolledMod>,
    locked_groups: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct MctsPolicyStep {
    pub state: String,
    pub action: String,
    pub visits: u32,
    pub success_rate: f64,
}

#[derive(Debug, Clone)]
pub struct PolicyEvaluation {
    pub attempts: u32,
    pub successes: u32,
    pub success_probability: f64,
    pub average_attempt_cost: f64,
    pub expected_cost: f64,
    pub reliable: bool,
}

#[derive(Debug, Clone)]
pub struct MctsResult {
    pub iterations: u32,
    pub states_explored: usize,
    pub successes: u32,
    pub best_action: Option<String>,
    pub evaluation: PolicyEvaluation,
    pub policy: Vec<MctsPolicyStep>,
}

#[derive(Debug, Clone)]
struct EdgeStats {
    action_id: &'static str,
    visits: u32,
    successes: u32,
    total_reward: f64,
}

#[derive(Debug, Clone)]
struct NodeStats {
    state: ItemState,
    visits: u32,
    edges: Vec<EdgeStats>,
}

struct Rng {
    state: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.state as f64 / 0x1_0000_0000u64 as f64
    }
}

const ACTION_IDS: &[&str] = &[
    "transmute",
    "greater-transmute",
    "perfect-transmute",
    "augment",
    "greater-augment",
    "perfect-augment",
    "regal",
    "greater-regal",
    "perfect-regal",
    "omen-sinistral-coronation",
    "omen-dextral-coronation",
    "alchemy",
    "omen-sinistral-alchemy",
    "omen-dextral-alchemy",
    "exalt",
    "greater-exalt",
    "perfect-exalt",
    "omen-sinistral-exaltation",
    "omen-dextral-exaltation",
    "omen-greater-exaltation",
];

fn initial_state(item_level: u32) -> ItemState {
    ItemState {
        item_level,
        rarity: Rarity::Normal,
        prefixes: Vec::new(),
        suffixes: Vec::new(),
        locked_groups: Vec::new(),
    }
}

fn mod_count(state: &ItemState) -> usize {
    state.prefixes.len() + state.suffixes.len()
}

fn state_key(state: &ItemState) -> String {
    let mut prefixes: Vec<&str> = state.prefixes.iter().map(|modifier| modifier.mod_id.as_str()).collect();
    let mut suffixes: Vec<&str> = state.suffixes.iter().map(|modifier| modifier.mod_id.as_str()).collect();
    let mut groups: Vec<&str> = state.locked_groups.iter().map(String::as_str).collect();
    prefixes.sort_unstable();
    suffixes.sort_unstable();
    groups.sort_unstable();
    format!(
        "{}|{:?}|{}|{}|{}",
        state.item_level,
        state.rarity,
        prefixes.join(","),
        suffixes.join(","),
        groups.join(",")
    )
}

fn add_mod(state: &ItemState, modifier: &Mod) -> ItemState {
    let rolled = RolledMod {
        mod_id: modifier.id.clone(),
        name: modifier.name.clone(),
        affix: modifier.affix,
    };
    let mut next = state.clone();
    match modifier.affix {
        Affix::Prefix => next.prefixes.push(rolled),
        Affix::Suffix => next.suffixes.push(rolled),
    }
    if let Some(group) = &modifier.group {
        if !next.locked_groups.iter().any(|existing| existing == group) {
            next.locked_groups.push(group.clone());
            next.locked_groups.sort();
        }
    }
    next
}

fn target_hit(state: &ItemState, target: &TargetMod) -> bool {
    state
        .prefixes
        .iter()
        .chain(state.suffixes.iter())
        .any(|modifier| modifier.mod_id == target.id && modifier.affix == target.affix)
}

fn is_success(state: &ItemState, targets: &[TargetMod], target_mode: TargetMode) -> bool {
    targets.iter().all(|target| target_hit(state, target))
        && (target_mode == TargetMode::AllowExtra || mod_count(state) == targets.len())
}

fn is_feasible(state: &ItemState, targets: &[TargetMod]) -> bool {
    let missing_prefixes = targets.iter().filter(|target| target.affix == Affix::Prefix && !target_hit(state, target)).count();
    let missing_suffixes = targets.iter().filter(|target| target.affix == Affix::Suffix && !target_hit(state, target)).count();
    let max_affixes = if state.rarity == Rarity::Magic { 1 } else { 3 };
    missing_prefixes <= max_affixes - state.prefixes.len() && missing_suffixes <= max_affixes - state.suffixes.len()
}

fn can_roll_mod(state: &ItemState, modifier: &Mod) -> bool {
    if state.prefixes.iter().chain(state.suffixes.iter()).any(|rolled| rolled.mod_id == modifier.id) {
        return false;
    }
    if modifier.group.as_ref().is_some_and(|group| state.locked_groups.iter().any(|locked| locked == group)) {
        return false;
    }
    let max_total = if state.rarity == Rarity::Rare { 6 } else { 2 };
    if mod_count(state) >= max_total {
        return false;
    }
    match modifier.affix {
        Affix::Prefix if state.prefixes.len() >= 3 => return false,
        Affix::Suffix if state.suffixes.len() >= 3 => return false,
        Affix::Prefix if state.rarity == Rarity::Magic && !state.prefixes.is_empty() => return false,
        Affix::Suffix if state.rarity == Rarity::Magic && !state.suffixes.is_empty() => return false,
        _ => {}
    }
    true
}

fn eligible_pool<'a>(
    profile: &'a ItemProfile,
    state: &ItemState,
    affix_filter: Option<Affix>,
    minimum_modifier_level: Option<u32>,
) -> Vec<&'a Mod> {
    profile
        .mods
        .iter()
        .filter(|modifier| modifier.level <= state.item_level)
        .filter(|modifier| minimum_modifier_level.map_or(true, |minimum| modifier.level >= minimum))
        .filter(|modifier| affix_filter.map_or(true, |affix| modifier.affix == affix))
        .filter(|modifier| modifier.item_classes.iter().any(|class| class == &profile.base_item.item_class))
        .filter(|modifier| can_roll_mod(state, modifier))
        .collect()
}

fn weight(modifier: &Mod, weight_mode: WeightMode) -> f64 {
    match weight_mode {
        WeightMode::Equal => 1.0,
        WeightMode::Visible => modifier.weight.unwrap_or(1.0).max(0.0),
    }
}

fn roll_one(
    state: &ItemState,
    profile: &ItemProfile,
    weight_mode: WeightMode,
    rng: &mut Rng,
    affix_filter: Option<Affix>,
    minimum_modifier_level: Option<u32>,
) -> Option<ItemState> {
    let pool = eligible_pool(profile, state, affix_filter, minimum_modifier_level);
    let total: f64 = pool.iter().map(|modifier| weight(modifier, weight_mode)).sum();
    if total <= 0.0 {
        return None;
    }
    let mut roll = rng.next() * total;
    for modifier in pool {
        roll -= weight(modifier, weight_mode);
        if roll <= 0.0 {
            return Some(add_mod(state, modifier));
        }
    }
    None
}

fn roll_many(
    mut state: ItemState,
    count: usize,
    profile: &ItemProfile,
    weight_mode: WeightMode,
    rng: &mut Rng,
    affix_filter: Option<Affix>,
    minimum_modifier_level: Option<u32>,
) -> Option<ItemState> {
    for _ in 0..count {
        state = roll_one(&state, profile, weight_mode, rng, affix_filter, minimum_modifier_level)?;
    }
    Some(state)
}

fn minimum_level(action_id: &str) -> Option<u32> {
    match action_id {
        "greater-transmute" | "greater-augment" => Some(55),
        "perfect-transmute" | "perfect-augment" => Some(70),
        "greater-regal" | "greater-exalt" => Some(35),
        "perfect-regal" | "perfect-exalt" => Some(50),
        _ => None,
    }
}

fn can_apply(action_id: &str, state: &ItemState) -> bool {
    match action_id {
        "restart" | "stop" => true,
        "transmute" | "greater-transmute" | "perfect-transmute" => state.rarity == Rarity::Normal,
        "augment" | "greater-augment" | "perfect-augment" => state.rarity == Rarity::Magic && mod_count(state) < 2,
        "regal" | "greater-regal" | "perfect-regal" | "omen-sinistral-coronation" | "omen-dextral-coronation" => {
            state.rarity == Rarity::Magic
        }
        "alchemy" | "omen-sinistral-alchemy" | "omen-dextral-alchemy" => state.rarity == Rarity::Normal || state.rarity == Rarity::Magic,
        "exalt" | "greater-exalt" | "perfect-exalt" | "omen-sinistral-exaltation" | "omen-dextral-exaltation" => {
            state.rarity == Rarity::Rare && mod_count(state) < 6
        }
        "omen-greater-exaltation" => state.rarity == Rarity::Rare && mod_count(state) < 5,
        _ => false,
    }
}

fn action_roll_count(action_id: &str, state: &ItemState) -> u32 {
    match action_id {
        "alchemy" => 4_u32.saturating_sub(mod_count(state) as u32),
        "omen-sinistral-alchemy" | "omen-dextral-alchemy" => 4,
        "omen-greater-exaltation" => 2,
        "restart" | "stop" => 0,
        _ => 1,
    }
}

fn sample_action(
    state: &ItemState,
    action_id: &str,
    profile: &ItemProfile,
    item_level: u32,
    weight_mode: WeightMode,
    rng: &mut Rng,
) -> Option<ItemState> {
    if action_id == "restart" {
        return Some(initial_state(item_level));
    }
    if action_id == "stop" {
        return Some(state.clone());
    }

    match action_id {
        "omen-sinistral-coronation" | "omen-dextral-coronation" => roll_many(
            ItemState { rarity: Rarity::Rare, ..state.clone() },
            1,
            profile,
            weight_mode,
            rng,
            Some(if action_id == "omen-sinistral-coronation" { Affix::Prefix } else { Affix::Suffix }),
            None,
        ),
        "omen-sinistral-exaltation" | "omen-dextral-exaltation" => roll_many(
            state.clone(),
            1,
            profile,
            weight_mode,
            rng,
            Some(if action_id == "omen-sinistral-exaltation" { Affix::Prefix } else { Affix::Suffix }),
            None,
        ),
        "omen-greater-exaltation" => roll_many(state.clone(), 2, profile, weight_mode, rng, None, None),
        "omen-sinistral-alchemy" | "omen-dextral-alchemy" => {
            let mut rare = ItemState { rarity: Rarity::Rare, prefixes: Vec::new(), suffixes: Vec::new(), locked_groups: Vec::new(), ..state.clone() };
            let pattern = if action_id == "omen-sinistral-alchemy" {
                [Affix::Prefix, Affix::Prefix, Affix::Prefix, Affix::Suffix]
            } else {
                [Affix::Prefix, Affix::Suffix, Affix::Suffix, Affix::Suffix]
            };
            for affix in pattern {
                rare = roll_many(rare, 1, profile, weight_mode, rng, Some(affix), None)?;
            }
            Some(rare)
        }
        "alchemy" => roll_many(
            ItemState { rarity: Rarity::Rare, prefixes: Vec::new(), suffixes: Vec::new(), locked_groups: Vec::new(), ..state.clone() },
            4,
            profile,
            weight_mode,
            rng,
            None,
            None,
        ),
        id if id.ends_with("transmute") => roll_many(ItemState { rarity: Rarity::Magic, ..state.clone() }, 1, profile, weight_mode, rng, None, minimum_level(id)),
        id if id.ends_with("augment") => roll_many(state.clone(), 1, profile, weight_mode, rng, None, minimum_level(id)),
        id if id.ends_with("regal") => roll_many(ItemState { rarity: Rarity::Rare, ..state.clone() }, 1, profile, weight_mode, rng, None, minimum_level(id)),
        id if id.ends_with("exalt") => roll_many(state.clone(), 1, profile, weight_mode, rng, None, minimum_level(id)),
        _ => None,
    }
}

fn action_cost(action_id: &str) -> f64 {
    match action_id {
        "restart" | "stop" => 0.0,
        "transmute" => 0.05,
        "greater-transmute" => 1.0,
        "perfect-transmute" => 3.0,
        "augment" => 0.05,
        "greater-augment" => 2.0,
        "perfect-augment" => 8.0,
        "regal" => 0.5,
        "greater-regal" => 1.0,
        "perfect-regal" => 3.0,
        "alchemy" => 0.86,
        "exalt" => 1.0,
        "greater-exalt" => 2.0,
        "perfect-exalt" => 6.0,
        "omen-sinistral-coronation" | "omen-dextral-coronation" => 1.5,
        "omen-sinistral-alchemy" | "omen-dextral-alchemy" => 1.86,
        "omen-sinistral-exaltation" | "omen-dextral-exaltation" | "omen-greater-exaltation" => 2.0,
        _ => 0.0,
    }
}

fn action_name(action_id: &str) -> String {
    match action_id {
        "transmute" => "Orb of Transmutation",
        "greater-transmute" => "Greater Orb of Transmutation",
        "perfect-transmute" => "Perfect Orb of Transmutation",
        "augment" => "Orb of Augmentation",
        "greater-augment" => "Greater Orb of Augmentation",
        "perfect-augment" => "Perfect Orb of Augmentation",
        "regal" => "Regal Orb",
        "greater-regal" => "Greater Regal Orb",
        "perfect-regal" => "Perfect Regal Orb",
        "alchemy" => "Orb of Alchemy",
        "exalt" => "Exalted Orb",
        "greater-exalt" => "Greater Exalted Orb",
        "perfect-exalt" => "Perfect Exalted Orb",
        "omen-sinistral-coronation" => "Omen Prefix Regal",
        "omen-dextral-coronation" => "Omen Suffix Regal",
        "omen-sinistral-alchemy" => "Omen Prefix Alchemy",
        "omen-dextral-alchemy" => "Omen Suffix Alchemy",
        "omen-sinistral-exaltation" => "Omen Prefix Exalt",
        "omen-dextral-exaltation" => "Omen Suffix Exalt",
        "omen-greater-exaltation" => "Omen Greater Exalt",
        "restart" => "Restart",
        "stop" => "Stop",
        other => other,
    }
    .to_string()
}

fn legal_actions(state: &ItemState, targets: &[TargetMod], target_mode: TargetMode, max_explicit_mods: u32) -> Vec<&'static str> {
    if is_success(state, targets, target_mode) {
        return vec!["stop"];
    }
    if !is_feasible(state, targets) || mod_count(state) as u32 >= max_explicit_mods {
        return vec!["restart"];
    }
    ACTION_IDS
        .iter()
        .copied()
        .chain(["restart"])
        .filter(|action_id| can_apply(action_id, state))
        .filter(|action_id| mod_count(state) as u32 + action_roll_count(action_id, state) <= max_explicit_mods || *action_id == "restart")
        .collect()
}

fn describe_state(state: &ItemState, profile: &ItemProfile, targets: &[TargetMod]) -> String {
    if mod_count(state) == 0 {
        return format!("Fresh {}", profile.base_item.name);
    }
    let target_mods: Vec<&str> = state
        .prefixes
        .iter()
        .chain(state.suffixes.iter())
        .filter(|modifier| targets.iter().any(|target| target.id == modifier.mod_id))
        .map(|modifier| modifier.name.as_str())
        .collect();
    if !target_mods.is_empty() {
        return format!("If item has {}", target_mods.join(" + "));
    }
    format!("If item is {:?} with {} prefixes and {} suffixes", state.rarity, state.prefixes.len(), state.suffixes.len())
}

fn ucb(edge: &EdgeStats, node_visits: u32, exploration: f64) -> f64 {
    if edge.visits == 0 {
        return f64::INFINITY;
    }
    edge.total_reward / edge.visits as f64 + exploration * ((node_visits.max(1) as f64).ln() / edge.visits as f64).sqrt()
}

fn best_edge_action(node: &NodeStats) -> Option<&'static str> {
    node.edges
        .iter()
        .filter(|edge| edge.visits > 0)
        .max_by(|left, right| {
            let left_score = left.total_reward / left.visits.max(1) as f64;
            let right_score = right.total_reward / right.visits.max(1) as f64;
            left_score.total_cmp(&right_score)
        })
        .map(|edge| edge.action_id)
}

fn evaluate_policy(
    profile: &ItemProfile,
    targets: &[TargetMod],
    target_mode: TargetMode,
    max_explicit_mods: u32,
    weight_mode: WeightMode,
    nodes: &HashMap<String, NodeStats>,
    attempts: u32,
    reliable_successes: u32,
    max_steps: u32,
    item_level: u32,
) -> PolicyEvaluation {
    let mut rng = Rng::new(0x51ed_c0de);
    let mut successes = 0;
    let mut completed_attempts = 0;
    let mut total_cost = 0.0;

    for _ in 0..attempts {
        completed_attempts += 1;
        let mut state = Some(initial_state(item_level));
        let mut cost = 0.0;

        for _ in 0..max_steps {
            let Some(current) = state.clone() else { break; };
            if is_success(&current, targets, target_mode) {
                break;
            }
            let action_id = nodes
                .get(&state_key(&current))
                .and_then(best_edge_action)
                .filter(|action_id| legal_actions(&current, targets, target_mode, max_explicit_mods).contains(action_id))
                .unwrap_or("restart");
            if action_id == "stop" {
                break;
            }
            cost += action_cost(action_id);
            state = sample_action(&current, action_id, profile, item_level, weight_mode, &mut rng);
            if action_id == "restart" {
                break;
            }
        }

        let success = state.as_ref().is_some_and(|current| is_success(current, targets, target_mode));
        if success {
            successes += 1;
        }
        total_cost += cost;
        if successes >= reliable_successes {
            break;
        }
    }

    let success_probability = successes as f64 / completed_attempts.max(1) as f64;
    let average_attempt_cost = total_cost / completed_attempts.max(1) as f64;
    PolicyEvaluation {
        attempts: completed_attempts,
        successes,
        success_probability,
        average_attempt_cost,
        expected_cost: if success_probability > 0.0 { average_attempt_cost / success_probability } else { f64::INFINITY },
        reliable: successes >= reliable_successes,
    }
}

pub fn run_mcts(
    profile: &ItemProfile,
    targets: &[TargetMod],
    target_mode: TargetMode,
    max_explicit_mods: u32,
    weight_mode: WeightMode,
    iterations: u32,
    max_steps: u32,
    evaluation_attempts: u32,
    reliable_successes: u32,
) -> MctsResult {
    let item_level = targets.iter().map(|target| target.level).max().unwrap_or(1);
    let mut rng = Rng::new(0x9e37_79b9);
    let mut nodes: HashMap<String, NodeStats> = HashMap::new();
    let mut successes = 0;

    for _ in 0..iterations {
        let mut state = Some(initial_state(item_level));
        let mut cost = 0.0;
        let mut path: Vec<(String, &'static str)> = Vec::new();

        for _ in 0..max_steps {
            let Some(current) = state.clone() else { break; };
            if is_success(&current, targets, target_mode) {
                break;
            }

            let key = state_key(&current);
            let actions = legal_actions(&current, targets, target_mode, max_explicit_mods);
            let node = nodes.entry(key.clone()).or_insert_with(|| NodeStats {
                state: current.clone(),
                visits: 0,
                edges: actions
                    .iter()
                    .map(|action_id| EdgeStats { action_id, visits: 0, successes: 0, total_reward: 0.0 })
                    .collect(),
            });
            node.visits += 1;
            let Some(edge) = node.edges.iter().max_by(|left, right| ucb(left, node.visits, 1.4).total_cmp(&ucb(right, node.visits, 1.4))) else {
                break;
            };
            let action_id = edge.action_id;
            if action_id == "stop" {
                break;
            }
            path.push((key, action_id));
            cost += action_cost(action_id);
            state = sample_action(&current, action_id, profile, item_level, weight_mode, &mut rng);
            if action_id == "restart" {
                break;
            }
        }

        let success = state.as_ref().is_some_and(|current| is_success(current, targets, target_mode));
        if success {
            successes += 1;
        }
        let reward = if success { 1.0 / (1.0 + cost) } else { 0.0 };

        for (key, action_id) in path {
            if let Some(node) = nodes.get_mut(&key) {
                if let Some(edge) = node.edges.iter_mut().find(|edge| edge.action_id == action_id) {
                    edge.visits += 1;
                    edge.successes += u32::from(success);
                    edge.total_reward += reward;
                }
            }
        }
    }

    let root_key = state_key(&initial_state(item_level));
    let best_action = nodes.get(&root_key).and_then(|root| {
        best_edge_action(root).map(action_name)
    });
    let evaluation = evaluate_policy(
        profile,
        targets,
        target_mode,
        max_explicit_mods,
        weight_mode,
        &nodes,
        evaluation_attempts,
        reliable_successes,
        max_steps,
        item_level,
    );
    let mut policy: Vec<MctsPolicyStep> = nodes
        .values()
        .filter(|node| node.visits > 0)
        .filter_map(|node| {
            let action_id = best_edge_action(node)?;
            let edge = node.edges.iter().find(|edge| edge.action_id == action_id)?;
            Some(MctsPolicyStep {
                state: describe_state(&node.state, profile, targets),
                action: action_name(action_id),
                visits: edge.visits,
                success_rate: edge.successes as f64 / edge.visits.max(1) as f64,
            })
        })
        .collect();
    policy.sort_by(|left, right| right.visits.cmp(&left.visits));
    policy.truncate(8);

    MctsResult {
        iterations,
        states_explored: nodes.len(),
        successes,
        best_action,
        evaluation,
        policy,
    }
}
