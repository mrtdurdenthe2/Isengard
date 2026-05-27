export type Poe2dbModifierPage = {
  id: string;
  label: string;
  itemClass: string;
  url: string;
};

const poe2dbBaseUrl = "https://poe2db.tw/us";

export const poe2dbWeaponModifierPages: Poe2dbModifierPage[] = [
  { id: "claws", label: "Claws", itemClass: "claw", url: `${poe2dbBaseUrl}/Claws#ModifiersCalc` },
  { id: "daggers", label: "Daggers", itemClass: "dagger", url: `${poe2dbBaseUrl}/Daggers#ModifiersCalc` },
  { id: "wands", label: "Wands", itemClass: "wand", url: `${poe2dbBaseUrl}/Wands#ModifiersCalc` },
  { id: "one-hand-swords", label: "One Hand Swords", itemClass: "one_hand_sword", url: `${poe2dbBaseUrl}/One_Hand_Swords#ModifiersCalc` },
  { id: "one-hand-axes", label: "One Hand Axes", itemClass: "one_hand_axe", url: `${poe2dbBaseUrl}/One_Hand_Axes#ModifiersCalc` },
  { id: "one-hand-maces", label: "One Hand Maces", itemClass: "one_hand_mace", url: `${poe2dbBaseUrl}/One_Hand_Maces#ModifiersCalc` },
  { id: "sceptres", label: "Sceptres", itemClass: "sceptre", url: `${poe2dbBaseUrl}/Sceptres#ModifiersCalc` },
  { id: "spears", label: "Spears", itemClass: "spear", url: `${poe2dbBaseUrl}/Spears#ModifiersCalc` },
  { id: "flails", label: "Flails", itemClass: "flail", url: `${poe2dbBaseUrl}/Flails#ModifiersCalc` },
  { id: "bows", label: "Bows", itemClass: "bow", url: `${poe2dbBaseUrl}/Bows#ModifiersCalc` },
  { id: "staves", label: "Staves", itemClass: "staff", url: `${poe2dbBaseUrl}/Staves#ModifiersCalc` },
  { id: "two-hand-swords", label: "Two Hand Swords", itemClass: "two_hand_sword", url: `${poe2dbBaseUrl}/Two_Hand_Swords#ModifiersCalc` },
  { id: "two-hand-axes", label: "Two Hand Axes", itemClass: "two_hand_axe", url: `${poe2dbBaseUrl}/Two_Hand_Axes#ModifiersCalc` },
  { id: "two-hand-maces", label: "Two Hand Maces", itemClass: "two_hand_mace", url: `${poe2dbBaseUrl}/Two_Hand_Maces#ModifiersCalc` },
  { id: "quarterstaves", label: "Quarterstaves", itemClass: "quarterstaff", url: `${poe2dbBaseUrl}/Quarterstaves#ModifiersCalc` },
  { id: "crossbows", label: "Crossbows", itemClass: "crossbow", url: `${poe2dbBaseUrl}/Crossbows#ModifiersCalc` },
  { id: "traps", label: "Traps", itemClass: "trap", url: `${poe2dbBaseUrl}/Traps#ModifiersCalc` },
  { id: "talismans", label: "Talismans", itemClass: "talisman", url: `${poe2dbBaseUrl}/Talismans#ModifiersCalc` },
];
