use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Affix {
    Prefix,
    Suffix,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub provider: String,
    #[serde(rename = "ref")]
    pub ref_: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseItem {
    pub id: String,
    pub name: String,
    pub item_class: String,
    pub tags: Vec<String>,
    pub source: Option<Source>,
    pub price_source: Option<Source>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub name: String,
    pub text: String,
    pub affix: Affix,
    pub level: u32,
    pub tier: u32,
    pub families: Vec<String>,
    pub item_classes: Vec<String>,
    pub weight: Option<f64>,
    pub group: Option<String>,
    pub source: Option<Source>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemProfile {
    pub id: String,
    pub base_item: BaseItem,
    pub mods: Vec<Mod>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DataFile {
    pub profiles: Vec<ItemProfile>,
}

#[derive(Debug, Clone)]
pub struct TargetMod {
    pub id: String,
    pub affix: Affix,
    pub tier: u32,
    pub level: u32,
    pub text: String,
}
