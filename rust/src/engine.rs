#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightMode {
    Equal,
    Visible,
}

use crate::types::TargetMod;

pub fn optimal_item_level(targets: &[TargetMod]) -> u32 {
    targets.iter().map(|target| target.level).max().unwrap_or(1)
}
