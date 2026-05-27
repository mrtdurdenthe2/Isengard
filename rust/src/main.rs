mod data;
mod engine;
mod mcts;
mod types;

use engine::{optimal_item_level, WeightMode};
use gpui::{prelude::*, *};
use gpui_platform::application;
use mcts::{run_mcts, MctsResult, TargetMode};
use std::sync::mpsc;
use std::time::Duration;
use types::{Affix, ItemProfile, Mod, TargetMod};

#[derive(Clone)]
struct ModifierChoice {
    index: usize,
    id: String,
    tier: u32,
    level: u32,
}

#[derive(Clone)]
struct ModifierGroup {
    key: String,
    label: String,
    choices: Vec<ModifierChoice>,
}

struct IsengardApp {
    profiles: Vec<ItemProfile>,
    selected_profile: usize,
    selected_prefix: Option<usize>,
    selected_suffix: Option<usize>,
    profile_dropdown_open: bool,
    open_prefix_group: Option<String>,
    open_suffix_group: Option<String>,
    target_mode: TargetMode,
    max_explicit_mods: u32,
    weight_mode: WeightMode,
    mcts_result: Option<MctsResult>,
    mcts_running: bool,
    mcts_generation: u64,
    mcts_progress: f32,
    mcts_status: String,
}

impl IsengardApp {
    fn new() -> Self {
        let profiles = data::load_profiles().unwrap_or_else(|err| {
            eprintln!("{err:?}");
            Vec::new()
        });
        let mut app = Self {
            profiles,
            selected_profile: 0,
            selected_prefix: None,
            selected_suffix: None,
            profile_dropdown_open: false,
            open_prefix_group: None,
            open_suffix_group: None,
            target_mode: TargetMode::AllowExtra,
            max_explicit_mods: 2,
            weight_mode: WeightMode::Equal,
            mcts_result: None,
            mcts_running: false,
            mcts_generation: 0,
            mcts_progress: 0.0,
            mcts_status: String::new(),
        };
        app.select_defaults();
        app
    }

    fn profile(&self) -> Option<&ItemProfile> {
        self.profiles.get(self.selected_profile)
    }

    fn select_defaults(&mut self) {
        let prefix = self
            .profile()
            .and_then(|profile| profile.mods.iter().position(|modifier| modifier.affix == Affix::Prefix));
        let suffix = self
            .profile()
            .and_then(|profile| profile.mods.iter().position(|modifier| modifier.affix == Affix::Suffix));
        self.selected_prefix = prefix;
        self.selected_suffix = suffix;
        self.open_prefix_group = self.selected_group_key(Affix::Prefix);
        self.open_suffix_group = self.selected_group_key(Affix::Suffix);
    }

    fn selected_group_key(&self, affix: Affix) -> Option<String> {
        let selected = match affix {
            Affix::Prefix => self.selected_prefix,
            Affix::Suffix => self.selected_suffix,
        }?;
        self.profile()
            .and_then(|profile| profile.mods.get(selected))
            .map(Self::modifier_group_key)
    }

    fn modifier_group_key(modifier: &Mod) -> String {
        format!(
            "{:?}:{}",
            modifier.affix,
            modifier
                .group
                .as_deref()
                .or_else(|| modifier.families.first().map(String::as_str))
                .unwrap_or(&modifier.name)
        )
    }

    fn modifier_group_label(modifier: &Mod) -> String {
        modifier
            .families
            .first()
            .map(String::as_str)
            .or(modifier.group.as_deref())
            .unwrap_or(&modifier.name)
            .replace('_', " ")
    }

    fn modifier_groups(profile: &ItemProfile, affix: Affix) -> Vec<ModifierGroup> {
        let mut groups: Vec<ModifierGroup> = Vec::new();
        for (index, modifier) in profile.mods.iter().enumerate().filter(|(_, modifier)| modifier.affix == affix) {
            let key = Self::modifier_group_key(modifier);
            let choice = ModifierChoice {
                index,
                id: modifier.id.clone(),
                tier: modifier.tier,
                level: modifier.level,
            };
            if let Some(group) = groups.iter_mut().find(|group| group.key == key) {
                group.choices.push(choice);
            } else {
                groups.push(ModifierGroup {
                    key,
                    label: Self::modifier_group_label(modifier),
                    choices: vec![choice],
                });
            }
        }
        for group in &mut groups {
            group.choices.sort_by(|left, right| left.tier.cmp(&right.tier).then_with(|| right.level.cmp(&left.level)));
        }
        groups.sort_by(|left, right| left.label.cmp(&right.label));
        groups
    }

    fn targets(&self) -> Vec<TargetMod> {
        let Some(profile) = self.profile() else { return Vec::new(); };
        [self.selected_prefix, self.selected_suffix]
            .into_iter()
            .flatten()
            .filter_map(|index| profile.mods.get(index))
            .map(|modifier| TargetMod {
                id: modifier.id.clone(),
                affix: modifier.affix,
                tier: modifier.tier,
                level: modifier.level,
                text: modifier.text.clone(),
            })
            .collect()
    }

    fn toggle_profile_dropdown(&mut self, cx: &mut Context<Self>) {
        self.profile_dropdown_open = !self.profile_dropdown_open;
        cx.notify();
    }

    fn invalidate_mcts(&mut self) {
        self.mcts_result = None;
        self.mcts_running = false;
        self.mcts_progress = 0.0;
        self.mcts_status.clear();
        self.mcts_generation = self.mcts_generation.wrapping_add(1);
    }

    fn select_profile(&mut self, index: usize, cx: &mut Context<Self>) {
        if index >= self.profiles.len() {
            return;
        }
        self.selected_profile = index;
        self.profile_dropdown_open = false;
        self.select_defaults();
        self.invalidate_mcts();
        cx.notify();
    }

    fn select_target(&mut self, affix: Affix, index: usize, cx: &mut Context<Self>) {
        match affix {
            Affix::Prefix => self.selected_prefix = Some(index),
            Affix::Suffix => self.selected_suffix = Some(index),
        }
        self.invalidate_mcts();
        cx.notify();
    }

    fn remove_target(&mut self, affix: Affix, cx: &mut Context<Self>) {
        match affix {
            Affix::Prefix => self.selected_prefix = None,
            Affix::Suffix => self.selected_suffix = None,
        }
        self.invalidate_mcts();
        cx.notify();
    }

    fn toggle_modifier_group(&mut self, affix: Affix, key: String, cx: &mut Context<Self>) {
        let open = match affix {
            Affix::Prefix => &mut self.open_prefix_group,
            Affix::Suffix => &mut self.open_suffix_group,
        };
        if open.as_deref() == Some(key.as_str()) {
            *open = None;
        } else {
            *open = Some(key);
        }
        cx.notify();
    }

    fn toggle_weight_mode(&mut self, cx: &mut Context<Self>) {
        self.weight_mode = match self.weight_mode {
            WeightMode::Equal => WeightMode::Visible,
            WeightMode::Visible => WeightMode::Equal,
        };
        self.invalidate_mcts();
        cx.notify();
    }

    fn set_target_mode(&mut self, mode: TargetMode, cx: &mut Context<Self>) {
        self.target_mode = mode;
        self.invalidate_mcts();
        cx.notify();
    }

    fn adjust_max_explicit_mods(&mut self, delta: i32, cx: &mut Context<Self>) {
        self.max_explicit_mods = (self.max_explicit_mods as i32 + delta).clamp(2, 6) as u32;
        self.invalidate_mcts();
        cx.notify();
    }

    fn run_mcts_search(&mut self, cx: &mut Context<Self>) {
        if self.mcts_running {
            return;
        }
        let Some(profile) = self.profile().cloned() else { return; };
        let targets = self.targets();
        if targets.is_empty() {
            return;
        }
        let target_mode = self.target_mode;
        let max_explicit_mods = self.max_explicit_mods;
        let weight_mode = self.weight_mode;
        let generation = self.mcts_generation;
        self.mcts_running = true;
        self.mcts_result = None;
        self.mcts_progress = 0.02;
        self.mcts_status = "Starting MCTS search...".to_string();
        cx.notify();

        let (progress_tx, progress_rx) = mpsc::channel::<(f32, String)>();
        let task = cx.background_spawn(async move {
            run_mcts(
                &profile,
                &targets,
                target_mode,
                max_explicit_mods,
                weight_mode,
                100_000,
                6,
                500_000,
                500,
                move |progress, status| {
                    let _ = progress_tx.send((progress, status));
                },
            )
        });

        cx.spawn(async move |this, cx| {
            let task = task;
            while !task.is_ready() {
                cx.background_executor().timer(Duration::from_millis(250)).await;
                this.update(cx, |this, cx| {
                    if this.mcts_generation == generation && this.mcts_running {
                        for (progress, status) in progress_rx.try_iter() {
                            this.mcts_progress = progress.clamp(0.0, 1.0);
                            this.mcts_status = status;
                        }
                        cx.notify();
                    }
                })
                .ok();
            }

            let result = task.await;
            this.update(cx, |this, cx| {
                if this.mcts_generation == generation {
                    for (progress, status) in progress_rx.try_iter() {
                        this.mcts_progress = progress.clamp(0.0, 1.0);
                        this.mcts_status = status;
                    }
                    this.mcts_result = Some(result);
                    this.mcts_running = false;
                    this.mcts_progress = 1.0;
                    this.mcts_status = "Search and policy evaluation complete.".to_string();
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn render_modifier_column(
        title: &str,
        affix: Affix,
        groups: Vec<ModifierGroup>,
        selected_index: Option<usize>,
        open_group: Option<String>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut column = div()
            .id(format!("{title}-column"))
            .flex_1()
            .min_w(px(320.0))
            .h(px(420.0))
            .overflow_y_scroll()
            .rounded_md()
            .border_1()
            .border_color(rgb(0x2b3543))
            .p_3()
            .flex()
            .flex_col()
            .gap_2()
            .child(div().font_weight(FontWeight::BOLD).child(title.to_string()));

        for group in groups.into_iter().take(18) {
            let mut tier_row = div().flex().flex_wrap().gap_1();
            let tier_count = group.choices.len();
            let is_open = open_group.as_deref() == Some(group.key.as_str());
            let group_key = group.key.clone();

            for choice in group.choices {
                let selected = selected_index == Some(choice.index);
                let (bg, hover) = match (affix, selected) {
                    (Affix::Prefix, true) => (rgb(0x2f6f4e), rgb(0x397f5b)),
                    (Affix::Prefix, false) => (rgb(0x1f3a2f), rgb(0x28503f)),
                    (Affix::Suffix, true) => (rgb(0x6d4f87), rgb(0x7d5d9d)),
                    (Affix::Suffix, false) => (rgb(0x3b2b48), rgb(0x4d3860)),
                };
                let index = choice.index;
                tier_row = tier_row.child(
                    div()
                        .id(format!("{:?}-tier-{}", affix, choice.id))
                        .px_2()
                        .py_1()
                        .rounded_md()
                        .bg(bg)
                        .hover(move |style| style.bg(hover))
                        .cursor_pointer()
                        .on_click(cx.listener(move |this, _, _, cx| this.select_target(affix, index, cx)))
                        .child(format!("T{} ilvl {}", choice.tier, choice.level)),
                );
            }

            column = column.child(
                div()
                    .rounded_md()
                    .bg(rgb(0x101720))
                    .p_2()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .id(format!("{:?}-group-{}", affix, group.key))
                            .flex()
                            .justify_between()
                            .gap_2()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| this.toggle_modifier_group(affix, group_key.clone(), cx)))
                            .child(div().child(group.label))
                            .child(div().text_color(rgb(0x91a0b2)).child(format!("{} {tier_count} tiers", if is_open { "-" } else { "+" }))),
                    )
                    .when(is_open, |el| el.child(tier_row)),
            );
        }

        column
    }
}

impl Render for IsengardApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let profile_name = self.profile().map(|profile| profile.base_item.name.clone()).unwrap_or_else(|| "No data".into());
        let profile_position = if self.profiles.is_empty() { 0 } else { self.selected_profile + 1 };
        let profile_count = self.profiles.len();
        let profile_rows: Vec<(usize, String, usize, bool)> = self
            .profiles
            .iter()
            .enumerate()
            .map(|(index, profile)| (index, profile.base_item.name.clone(), profile.mods.len(), index == self.selected_profile))
            .collect();
        let targets = self.targets();
        let item_level = optimal_item_level(&targets);
        let prefix_groups = self.profile().map(|profile| Self::modifier_groups(profile, Affix::Prefix)).unwrap_or_default();
        let suffix_groups = self.profile().map(|profile| Self::modifier_groups(profile, Affix::Suffix)).unwrap_or_default();
        let target_mode_label = match self.target_mode {
            TargetMode::AllowExtra => "Set + random",
            TargetMode::Exact => "Exact set",
        };
        let route_note = if self.target_mode == TargetMode::Exact {
            "MCTS is optimizing for the exact selected modifier set; extra rolls invalidate success."
        } else {
            "MCTS is optimizing for selected modifiers while allowing extra random modifiers."
        };
        let mcts_running = self.mcts_running;
        let mcts_progress = self.mcts_progress.clamp(0.0, 1.0);
        let mcts_status = self.mcts_status.clone();
        let weight_mode = match self.weight_mode {
            WeightMode::Equal => "Equal",
            WeightMode::Visible => "Visible weights",
        };

        let mut selected_targets = div().flex().flex_col().gap_2();
        if targets.is_empty() {
            selected_targets = selected_targets.child(div().text_color(rgb(0x91a0b2)).child("No target modifiers selected."));
        }
        for target in &targets {
            let affix = target.affix;
            selected_targets = selected_targets.child(
                div()
                    .rounded_md()
                    .bg(rgb(0x101720))
                    .p_2()
                    .flex()
                    .justify_between()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(format!("{:?} T{} · ilvl {}", target.affix, target.tier, target.level))
                            .child(div().text_color(rgb(0x91a0b2)).child(target.text.clone())),
                    )
                    .child(
                        div()
                            .id(format!("remove-{:?}-target", target.affix))
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(rgb(0x3b2430))
                            .hover(|style| style.bg(rgb(0x5a3342)))
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_target(affix, cx)))
                            .child("x"),
                    ),
            );
        }

        let input_panel = div()
            .flex_1()
            .rounded_lg()
            .border_1()
            .border_color(rgb(0x2b3543))
            .bg(rgb(0x171d26))
            .p_4()
            .flex()
            .flex_col()
            .gap_3()
            .child(div().font_weight(FontWeight::BOLD).child("Craft Inputs"))
            .child(div().text_color(rgb(0x91a0b2)).child(format!("Profile {profile_position} of {profile_count}")))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(div().text_color(rgb(0x91a0b2)).child("Item type"))
                    .child(
                        div()
                            .id("item-type-dropdown")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(rgb(0x263142))
                            .hover(|style| style.bg(rgb(0x334158)))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_profile_dropdown(cx)))
                            .child(format!("{profile_name} v")),
                    )
                    .when(self.profile_dropdown_open, |el| {
                        el.child(
                            div()
                                .id("item-type-dropdown-list")
                                .h(px(220.0))
                                .overflow_y_scroll()
                                .rounded_md()
                                .border_1()
                                .border_color(rgb(0x2b3543))
                                .bg(rgb(0x101720))
                                .p_2()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .children(profile_rows.into_iter().map(|(index, name, count, selected)| {
                                    div()
                                        .id(format!("profile-option-{index}"))
                                        .px_2()
                                        .py_2()
                                        .rounded_md()
                                        .bg(if selected { rgb(0x2f6f4e) } else { rgb(0x101720) })
                                        .hover(|style| style.bg(rgb(0x263142)))
                                        .cursor_pointer()
                                        .on_click(cx.listener(move |this, _, _, cx| this.select_profile(index, cx)))
                                        .child(format!("{name} ({count} modifiers)"))
                                })),
                        )
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        div()
                            .id("target-mode-allow-extra")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(if self.target_mode == TargetMode::AllowExtra { rgb(0x2f6f4e) } else { rgb(0x263142) })
                            .hover(|style| style.bg(rgb(0x334158)))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.set_target_mode(TargetMode::AllowExtra, cx)))
                            .child("Set + random"),
                    )
                    .child(
                        div()
                            .id("target-mode-exact")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(if self.target_mode == TargetMode::Exact { rgb(0x2f6f4e) } else { rgb(0x263142) })
                            .hover(|style| style.bg(rgb(0x334158)))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.set_target_mode(TargetMode::Exact, cx)))
                            .child("Exact set"),
                    )
                    .child(
                        div()
                            .id("toggle-weight-mode")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(rgb(0x263142))
                            .hover(|style| style.bg(rgb(0x334158)))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_weight_mode(cx)))
                            .child(format!("Weights: {weight_mode}")),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        div()
                            .id("decrease-max-explicit")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(rgb(0x263142))
                            .hover(|style| style.bg(rgb(0x334158)))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.adjust_max_explicit_mods(-1, cx)))
                            .child("- max mods"),
                    )
                    .child(div().px_3().py_2().rounded_md().bg(rgb(0x101720)).child(format!("Max explicit mods: {}", self.max_explicit_mods)))
                    .child(
                        div()
                            .id("increase-max-explicit")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(rgb(0x263142))
                            .hover(|style| style.bg(rgb(0x334158)))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.adjust_max_explicit_mods(1, cx)))
                            .child("+ max mods"),
                    ),
            )
            .child(div().child(format!("Optimal item level: {item_level}")))
            .child(div().text_color(rgb(0x91a0b2)).child(format!("Modifier set: {target_mode_label}")))
            .child(
                div()
                    .flex()
                    .gap_3()
                    .child(Self::render_modifier_column(
                        "Base Prefix",
                        Affix::Prefix,
                        prefix_groups,
                        self.selected_prefix,
                        self.open_prefix_group.clone(),
                        cx,
                    ))
                    .child(Self::render_modifier_column(
                        "Base Suffix",
                        Affix::Suffix,
                        suffix_groups,
                        self.selected_suffix,
                        self.open_suffix_group.clone(),
                        cx,
                    )),
            )
            .child(div().font_weight(FontWeight::BOLD).child("Selected modifiers"))
            .child(selected_targets);

        let results_panel = div()
            .w(px(460.0))
            .rounded_lg()
            .border_1()
            .border_color(rgb(0x2b3543))
            .bg(rgb(0x171d26))
            .p_4()
            .flex()
            .flex_col()
            .gap_2()
            .child(div().font_weight(FontWeight::BOLD).child("MCTS Route Search"))
            .child(div().text_color(rgb(0x91a0b2)).child(route_note))
            .child(
                div()
                    .id("run-mcts")
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .bg(rgb(0x2f6f4e))
                    .hover(|style| style.bg(rgb(0x397f5b)))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.run_mcts_search(cx)))
                    .child(if mcts_running { "MCTS running..." } else { "Run MCTS search" }),
            )
            .when(mcts_running, |el| {
                el.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(div().text_color(rgb(0x91a0b2)).child(mcts_status))
                        .child(
                            div()
                                .w_full()
                                .h(px(10.0))
                                .rounded_md()
                                .bg(rgb(0x101720))
                                .child(
                                    div()
                                        .h(px(10.0))
                                        .rounded_md()
                                        .w(relative(mcts_progress))
                                        .bg(rgb(0x2f6f4e)),
                                ),
                        )
                        .child(div().text_color(rgb(0x91a0b2)).child("You can keep using the UI; changing inputs will discard this run.")),
                )
            })
            .when(!mcts_running && self.mcts_result.is_none(), |el| {
                el.child(div().text_color(rgb(0x91a0b2)).child("Run MCTS after selecting targets. Result is cleared when target, mode, cap, weapon, or weights change."))
            })
            .when_some(self.mcts_result.clone(), |el, result| {
                let evaluation = result.best_evaluation.clone();
                let reliability = if evaluation.reliable {
                    "Final policy evaluation: reliable enough for ranking"
                } else {
                    "Early policy evaluation: noisy, run more trials before trusting route ranking"
                };
                let winner = if result.mcts_won {
                    "MCTS policy is currently best among evaluated candidates"
                } else {
                    "Best template route beats MCTS result; MCTS search did not find an improvement"
                };
                el.child(
                    div()
                        .rounded_md()
                        .bg(rgb(0x203625))
                        .p_3()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().font_weight(FontWeight::BOLD).child(format!("Best evaluated route: {}", evaluation.label)))
                        .child(div().text_color(rgb(0x91a0b2)).child(winner))
                        .child(div().text_color(rgb(0x91a0b2)).child(reliability))
                        .child(div().child(format!("Evaluation attempts: {}", evaluation.attempts)))
                        .child(div().child(format!("Evaluation successes: {}", evaluation.successes)))
                        .child(div().child(format!("Final success chance: {:.4}%", evaluation.success_probability * 100.0)))
                        .child(div().child(format!("Average attempt cost: {:.2} ex", evaluation.average_attempt_cost)))
                        .child(div().child(format!("Expected cost: {:.2} ex", evaluation.expected_cost)))
                        .child(div().text_color(rgb(0x91a0b2)).child(format!(
                            "MCTS diagnostics: first action {}, {} iterations, {} noisy search successes, {} states explored",
                            result.best_action.unwrap_or_else(|| "n/a".to_string()), result.iterations, result.successes, result.states_explored
                        ))),
                )
                .child(
                    div()
                        .rounded_md()
                        .bg(rgb(0x101720))
                        .p_3()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().font_weight(FontWeight::BOLD).child("MCTS policy evaluation"))
                        .child(div().child(format!("Successes: {} / {}", result.mcts_evaluation.successes, result.mcts_evaluation.attempts)))
                        .child(div().child(format!("Success chance: {:.4}%", result.mcts_evaluation.success_probability * 100.0)))
                        .child(div().child(format!("Expected cost: {:.2} ex", result.mcts_evaluation.expected_cost))),
                )
                .children(result.baselines.into_iter().take(5).map(|baseline| {
                    div()
                        .rounded_md()
                        .bg(rgb(0x101720))
                        .p_3()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().font_weight(FontWeight::BOLD).child(format!("Template: {}", baseline.label)))
                        .child(div().child(format!("Successes: {} / {}", baseline.successes, baseline.attempts)))
                        .child(div().child(format!("Success chance: {:.4}%", baseline.success_probability * 100.0)))
                        .child(div().child(format!("Expected cost: {:.2} ex", baseline.expected_cost)))
                }))
                .children(result.policy.into_iter().map(|step| {
                    div()
                        .rounded_md()
                        .bg(rgb(0x101720))
                        .p_3()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().font_weight(FontWeight::BOLD).child(step.state))
                        .child(div().child(format!("Action: {}", step.action)))
                        .child(div().text_color(rgb(0x91a0b2)).child(format!(
                            "Search-only node stat: {} visits, {:.2}% success through this node/action",
                            step.visits,
                            step.success_rate * 100.0
                        )))
                }))
            });

        div()
            .size_full()
            .bg(rgb(0x0e1218))
            .text_color(rgb(0xe7edf4))
            .p_6()
            .font_family("Inter")
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .max_w(px(1400.0))
                    .child(div().text_xl().font_weight(FontWeight::BOLD).child("Isengard POE2 Craft Optimizer"))
                    .child(div().text_color(rgb(0x91a0b2)).child("Rust + GPUI port. Current milestone: MCTS-driven route search over currency actions."))
                    .child(div().flex().gap_4().child(input_panel).child(results_panel))
                    .child(
                        div()
                            .text_color(rgb(0x91a0b2))
                            .child("Next port milestones: move MCTS execution to a background GPUI task, source prices from poe2db/trade data, and add full modifier text search."),
                    ),
            )
    }
}

fn main() {
    application().run(|cx: &mut App| {
        cx.open_window(WindowOptions::default(), |_, cx| cx.new(|_| IsengardApp::new()))
            .expect("failed to open Isengard window");
        cx.activate(true);
    });
}
