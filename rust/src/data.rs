use anyhow::Context;

use crate::types::{DataFile, ItemProfile};

const POE2DB_DATA: &str = include_str!("../../src/generated/poe2db-data.json");

pub fn load_profiles() -> anyhow::Result<Vec<ItemProfile>> {
    let data: DataFile = serde_json::from_str(POE2DB_DATA).context("failed to parse generated poe2db data")?;
    Ok(data.profiles)
}
