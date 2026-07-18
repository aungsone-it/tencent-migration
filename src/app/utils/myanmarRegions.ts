/** Myanmar states/regions and their townships — checkout cascading selects.
 *  Township lists sourced from Myanmar GAD geography data (kyawthura-gg/myanmar-geography-json).
 */

import { MYANMAR_REGION_LABELS_MY, MYANMAR_TOWNSHIP_LABELS_MY } from "./myanmarRegionLabelsMy";

export const MYANMAR_REGIONS = [
  "Yangon",
  "Mandalay",
  "Naypyidaw",
  "Ayeyarwady",
  "Bago",
  "Chin",
  "Kachin",
  "Kayah",
  "Kayin",
  "Magway",
  "Mon",
  "Rakhine",
  "Sagaing",
  "Shan",
  "Tanintharyi",
] as const;

export type MyanmarRegion = (typeof MYANMAR_REGIONS)[number];

const REGION_TOWNSHIPS: Record<MyanmarRegion, readonly string[]> = {
  Yangon: [
    "Ahlone",
    "Ahpyauk",
    "Bahan",
    "Botataung",
    "Cocokyun",
    "Dagon",
    "Dagon Myothit (East)",
    "Dagon Myothit (North)",
    "Dagon Myothit (Seikkan)",
    "Dagon Myothit (South)",
    "Dala",
    "Dawbon",
    "East Dagon",
    "Hlaing",
    "Hlaingthaya",
    "Hlaingthaya (East)",
    "Hlaingthaya (West)",
    "Hlegu",
    "Hmawbi",
    "Htantabin",
    "Htaukkyant",
    "Insein",
    "Kamayut",
    "Kawhmu",
    "Kayan",
    "Kungyangon",
    "Kyauktada",
    "Kyauktan",
    "Kyimyindaing",
    "Lanmadaw",
    "Latha",
    "Mayangon",
    "Mingala Taungnyunt",
    "Mingaladon",
    "North Dagon",
    "North Okkalapa",
    "Okekan",
    "Pabedan",
    "Pazundaung",
    "Sanchaung",
    "Seikgyi Kanaungto",
    "Shwe Paunt Kan",
    "Shwepyithar",
    "South Dagon",
    "South Okkalapa",
    "Tadar",
    "Taikkyi",
    "Tamwe",
    "Thaketa",
    "Thanlyin",
    "Thingangyun",
    "Thongwa",
    "Twantay",
    "Yuzana Oo Yin",
    "Yankin",
  ],
  Mandalay: [
    "Amarapura",
    "Aungmyaythazan",
    "Bagan",
    "Chanayethazan",
    "Chanmyathazi",
    "Ku Me",
    "Kyaukpadaung",
    "Kyaukse",
    "Madaya",
    "Mahaaungmyay",
    "Mahlaing",
    "Meiktila",
    "Mogok",
    "Myingyan",
    "Myitnge",
    "Myittha",
    "Natogyi",
    "Ngathayauk",
    "Ngazun",
    "Nyaung-U",
    "Patheingyi",
    "Pyawbwe",
    "Pyigyitagun",
    "Pyin Oo Lwin",
    "Si Mee Khon",
    "Singu",
    "Sintgaing",
    "Tada-U",
    "Takaung",
    "Taungtha",
    "Thabeikkyin",
    "Thazi",
    "Wundwin",
    "Yamethin",
  ],
  Naypyidaw: [
    "Dekkhinathiri",
    "Lewe",
    "Ottarathiri",
    "Poke Ba Thi Ri",
    "Pyinmana",
    "Tatkon",
    "Zabuthiri",
    "Zeyarthiri",
  ],
  Ayeyarwady: [
    "Ahmar",
    "Ahtaung",
    "Ahthoke",
    "Batye",
    "Bogale",
    "Chaung Thar",
    "Danubyu",
    "Daga",
    "Dauntgyi",
    "Dedaye",
    "Du Yar",
    "Einme",
    "Hainggyikyun",
    "Hinthada",
    "Htoogyi",
    "In Pin",
    "Ingapu",
    "Kanaung",
    "Kangyidaunt",
    "Kyaiklat",
    "Kyangin",
    "Kyaunggon",
    "Kyonmangae",
    "Kyonpyaw",
    "Labutta",
    "Labutta (3) Mile",
    "Lemyethna",
    "Maubin",
    "Mawlamyinegyun",
    "Me Za Li Kone",
    "Myanaung",
    "Myaungmya",
    "Ngapudaw",
    "Ngathaingchaung",
    "Ngayokekaung",
    "Ngwesaung",
    "Nyaungdon",
    "Pantanaw",
    "Pathein",
    "Pyapon",
    "Pyinsalu",
    "Shwethaungyan",
    "Ta Loke Htaw",
    "Thabaung",
    "Wakema",
    "Yegyi",
    "Zalun",
  ],
  Bago: [
    "Bago",
    "Daik-U",
    "Gyobingauk",
    "Hpa Do",
    "Hpayargyi",
    "Hswar",
    "Inn Ma",
    "Inntakaw",
    "Kanyutkwin",
    "Kawa",
    "Kaytumati",
    "Kyaukkyi",
    "Kyauktaga",
    "Kywe Pwe",
    "Letpadan",
    "Madauk",
    "Minhla",
    "Monyo",
    "Myo Hla",
    "Nattalin",
    "Nyaungchedauk",
    "Nyaunglebin",
    "Oakshitpin",
    "Oe Thei Kone",
    "Okpho",
    "Oktwin",
    "Padaung",
    "Paukkhaung",
    "Paungdale",
    "Paungde",
    "Peinzalok",
    "Penwegon",
    "Phyu",
    "Puteekone",
    "Pyay",
    "Pyuntasa",
    "Shwedaung",
    "Shwegyin",
    "Sin Mee Swea",
    "Sit Kwin",
    "Tar Pun",
    "Taungoo",
    "Thanatpin",
    "Thayarwady",
    "Thegon",
    "Thetkala",
    "Thonse",
    "Waw",
    "Yae Ni",
    "Yedashe",
    "Zayyawadi",
    "Zigon",
  ],
  Chin: [
    "Cikha",
    "Falam",
    "Hakha",
    "Hnaring",
    "Kanpetlet",
    "Khaikam",
    "Kyin Dway",
    "Lalengpi",
    "M'kuiimnu",
    "Matupi",
    "Mindat",
    "Paletwa",
    "Rezua",
    "Rihkhawdar",
    "Samee",
    "Surkhua",
    "Tedim",
    "Thantlang",
    "Tonzang",
    "Webula",
  ],
  Kachin: [
    "Bhamo",
    "Chipwi",
    "Dawthponeyan",
    "Hopin",
    "Hpakant",
    "Injangyang",
    "Inn Taw Gyi",
    "Kamaing",
    "Kan Paik Ti",
    "Khaunglanhpu",
    "Lwegel",
    "Machanbaw",
    "Mansi",
    "Mogaung",
    "Mohnyin",
    "Momauk",
    "Myitkyina",
    "Myo Hla",
    "Nam Mar",
    "Nam Mun",
    "Nammatee",
    "Nawngmun",
    "Pang War",
    "Pannandin",
    "Putao",
    "Sadung",
    "Shin Bway Yang",
    "Shwegu",
    "Sinbo",
    "Sumprabum",
    "Tanai",
    "Tsawlaw",
    "Waingmaw",
  ],
  Kayah: [
    "Bawlakhe",
    "Demoso",
    "Hpasawng",
    "Hpruso",
    "Loikaw",
    "Loilen Lay",
    "Mese",
    "Nan Mei Khon",
    "Shadaw",
    "Ywarthit",
  ],
  Kayin: [
    "Baw Ga Li",
    "Hlaingbwe",
    "Hpa-An",
    "Hpapun",
    "Hpayarthonesu",
    "Kamarmaung",
    "Kawkareik",
    "Kyaikdon",
    "Kyainseikgyi",
    "Kyondoe",
    "Leik Tho",
    "Myawaddy",
    "Paingkyon",
    "Shan Ywar Thit",
    "Su Ka Li",
    "Thandaung",
    "Thandaunggyi",
    "Waw Lay Myaing (Waw Lay)",
  ],
  Magway: [
    "Aunglan",
    "Chauk",
    "Gangaw",
    "Kamma",
    "Kamma (PKU)",
    "Kyaukhtu",
    "Kyaw",
    "Magway",
    "Minbu",
    "Mindon",
    "Minhla",
    "Myaing",
    "Myit Chay",
    "Myothit",
    "Natmauk",
    "Ngape",
    "Pakokku",
    "Pauk",
    "Pwintbyu",
    "Sa Lay",
    "Saku",
    "Salin",
    "Saw",
    "Seikphyu",
    "Sidoktaya",
    "Sinbaungwe",
    "Sinphyukyun",
    "Taungdwingyi",
    "Thayet",
    "Tilin",
    "Yenangyaung",
    "Yesagyo",
  ],
  Mon: [
    "Bilin",
    "Chaungzon",
    "Kamarwet",
    "Khawzar",
    "Kyaikkhami",
    "Kyaikmaraw",
    "Kyaikto",
    "Lamaing",
    "Mawlamyine",
    "Mudon",
    "Paung",
    "Thanbyuzayat",
    "Thaton",
    "Thein Za Yat",
    "Thuwunnawady",
    "Ye",
    "Zinkyaik",
  ],
  Rakhine: [
    "Ann",
    "Buthidaung",
    "Gwa",
    "Kanhtauntkyi",
    "Kha Maung Seik",
    "Kyaukpyu",
    "Kyauktaw",
    "Kyeintali",
    "Lay Taung",
    "Ma-Ei",
    "Maungdaw",
    "Minbya",
    "Mrauk-U",
    "Munaung",
    "Myebon",
    "Myin Hlut",
    "Ngapali",
    "Pauktaw",
    "Ponnagyun",
    "Ramree",
    "Rathedaung",
    "Sa Ne",
    "Sittwe",
    "Tan Hlwe Ywar Ma",
    "Tat Taung",
    "Taungpyoletwea",
    "Taungup",
    "Thandwe",
  ],
  Sagaing: [
    "Ayadaw",
    "Banmauk",
    "Budalin",
    "Chaung-U",
    "Hkamti",
    "Homalin",
    "Indaw",
    "Kale",
    "Kalewa",
    "Kanbalu",
    "Kani",
    "Katha",
    "Kawlin",
    "Khampat",
    "Khin-U",
    "Kyauk Myaung",
    "Kyunhla",
    "Maw Lu",
    "Mawlaik",
    "Mingin",
    "Monywa",
    "Myaung",
    "Myinmu",
    "Myothit",
    "Pale",
    "Paungbyin",
    "Pinlebu",
    "Sagaing",
    "Saing Pyin",
    "Salingyi",
    "Sar Taung",
    "Shwe Pyi Aye",
    "Shwebo",
    "Tabayin",
    "Tamu",
    "Taze",
    "Tigyaing",
    "Wetlet",
    "Wuntho",
    "Ye-U",
    "Yinmarbin",
    "Zee Kone",
  ],
  Shan: [
    "Aungpan",
    "Ayetharyar",
    "Chinshwehaw",
    "He Hoe",
    "Hmone Hta",
    "Homein",
    "Hopang",
    "Hopong",
    "Hseni",
    "Hsihseng",
    "Hsipaw",
    "Intaw",
    "Kalaw",
    "Kar Li",
    "Kenglat",
    "Kengtawng",
    "Kengtung (Kyinetone)",
    "Kho Lam",
    "Konkyan",
    "Kunhing",
    "Kunlong",
    "Kutkai",
    "Kyaukme",
    "Kyauktalonegyi",
    "Kyethi",
    "Laihka",
    "Langkho",
    "Lashio",
    "Laukkaing",
    "Lawksawk (Yetsauk)",
    "Loilen",
    "Mabein",
    "Man Kan",
    "Manhlyoe (Manhero)",
    "Manton",
    "Matman",
    "Maw Hteik",
    "Mawkmai",
    "Monekoe",
    "Monghpyak",
    "Monghsat",
    "Monghsu",
    "Mongkaing",
    "Mongkhet",
    "Mongkhoke",
    "Mongla",
    "Monglon",
    "Mongmao",
    "Mongmit",
    "Mongnai (Moenae)",
    "Mongnawng",
    "Mongngawt",
    "Mongpan",
    "Mongping",
    "Mongsan (Hmonesan)",
    "Mongton",
    "Mongyai",
    "Mongyang",
    "Mongyawng",
    "Mongyu",
    "Muse",
    "Nam Tit",
    "Namhkan",
    "Namhsan",
    "Namphan",
    "Namtu",
    "Nang Pang",
    "Nansang (South)",
    "Naungtayar",
    "Nawnghkio (Naungcho)",
    "Nyaungshwe",
    "Pan Lon",
    "Pang Hseng (Kyu Koke)",
    "Pangwaun",
    "Pangsang (Panghkam)",
    "Pawng Lawng",
    "Pekon",
    "Pindaya",
    "Pinlaung",
    "Pinlon",
    "Ponparkyin",
    "Shwenyaung",
    "Tachileik",
    "Tangyan",
    "Tarlay",
    "Tarmoenye",
    "Taunggyi",
    "Tontar",
    "Ywangan",
  ],
  Tanintharyi: [
    "Bokpyin",
    "Dawei",
    "Kaleinaung",
    "Karathuri",
    "Kawthoung",
    "Khamaukgyi",
    "Kyunsu",
    "Launglon",
    "Maw Taung",
    "Myeik",
    "Myitta",
    "Pala",
    "Palauk",
    "Palaw",
    "Pyigyimandaing",
    "Tanintharyi",
    "Thayetchaung",
    "Yebyu",
  ],
};

const TOWNSHIP_ALIASES: Record<string, string> = {
  "Keng Tung": "Kengtung (Kyinetone)",
  "Kengtung": "Kengtung (Kyinetone)",
  "Kyaing Tong": "Kengtung (Kyinetone)",
  "Kyaingtong": "Kengtung (Kyinetone)",
  "Kyinetone": "Kengtung (Kyinetone)",
  "Naung Cho": "Nawnghkio (Naungcho)",
  "Naungcho": "Nawnghkio (Naungcho)",
  "Nawnghkio": "Nawnghkio (Naungcho)",
  "Nawngcho": "Nawnghkio (Naungcho)",
  "Shwe Pauk Kan": "Shwe Paunt Kan",
  "Shwe Paukkan": "Shwe Paunt Kan",
  "Yuzana OuYin": "Yuzana Oo Yin",
  "Lawksawk": "Lawksawk (Yetsauk)",
  "Moenae": "Mongnai (Moenae)",
  "Moe Nae": "Mongnai (Moenae)",
  "Mong Nai": "Mongnai (Moenae)",
  "Mongnai": "Mongnai (Moenae)",
  "Namsang": "Nansang (South)",
  "Namsang (South)": "Nansang (South)",
  "Namsang South": "Nansang (South)",
  "Nan San (South)": "Nansang (South)",
  "Nansang": "Nansang (South)",
  "Nyaung Chay Htauk": "Nyaungchedauk",
  "Nyaung Che Dauk": "Nyaungchedauk",
  "Yatsauk": "Lawksawk (Yetsauk)",
  "Yatsawk": "Lawksawk (Yetsauk)",
  "Yetsauk": "Lawksawk (Yetsauk)",
  "Bawlake": "Bawlakhe",
  "Botahtaung": "Botataung",
  "Daunggyi": "Dauntgyi",
  "Det Khi Na Thi Ri": "Dekkhinathiri",
  "Hlaingtharya (East)": "Hlaingthaya (East)",
  "Hlaingtharya (West)": "Hlaingthaya (West)",
  "Hmaw-bi": "Hmawbi",
  "Hmaw bi": "Hmawbi",
  "Kyeemyindaing": "Kyimyindaing",
  "Mayangone": "Mayangon",
  "Mingalartaungnyunt": "Mingala Taungnyunt",
  "Mogoke": "Mogok",
  "Mong Maw": "Mongmao",
  "Narphan": "Namphan",
  "Naphan": "Namphan",
  "Ngethyineshaung": "Ngathaingchaung",
  "Ngathinechaung": "Ngathaingchaung",
  "Oke Ta Ra Thi Ri": "Ottarathiri",
  "Panwai": "Pangwaun",
  "Panwine": "Pangwaun",
  "Pobbathiri": "Poke Ba Thi Ri",
  "Puta-O": "Putao",
  "Pyigyitagon": "Pyigyitagun",
  "Pyinoolwin": "Pyin Oo Lwin",
  "Seikgyikanaungto": "Seikgyi Kanaungto",
  "Tatkone": "Tatkon",
  "Thapaung": "Thabaung",
  "Thapaung Township": "Thabaung",
  "Toungup": "Taungup",
  "Za Bu Thi Ri": "Zabuthiri",
  "Zay Yar Thi Ri": "Zeyarthiri",
};

const REGION_LOOKUP = new Map<string, MyanmarRegion>();
for (const region of MYANMAR_REGIONS) {
  REGION_LOOKUP.set(region.toLowerCase(), region);
  const burmese = MYANMAR_REGION_LABELS_MY[region];
  if (burmese) REGION_LOOKUP.set(burmese.toLowerCase(), region);
}

function resolveTownshipAlias(value: string): string {
  return TOWNSHIP_ALIASES[value] || value;
}

const TOWNSHIP_TO_REGION = new Map<string, MyanmarRegion>();
const TOWNSHIP_LABEL_LOOKUP = new Map<string, string>();
for (const region of MYANMAR_REGIONS) {
  for (const township of REGION_TOWNSHIPS[region]) {
    TOWNSHIP_TO_REGION.set(township.toLowerCase(), region);
    TOWNSHIP_LABEL_LOOKUP.set(township.toLowerCase(), township);
    const burmese = MYANMAR_TOWNSHIP_LABELS_MY[township as keyof typeof MYANMAR_TOWNSHIP_LABELS_MY];
    if (burmese) {
      TOWNSHIP_LABEL_LOOKUP.set(burmese.toLowerCase(), township);
      TOWNSHIP_TO_REGION.set(burmese.toLowerCase(), region);
    }
  }
}
for (const [alias, canonical] of Object.entries(TOWNSHIP_ALIASES)) {
  const region = [...TOWNSHIP_TO_REGION.entries()].find(([, r]) =>
    REGION_TOWNSHIPS[r].includes(canonical)
  )?.[1];
  if (!region) continue;
  TOWNSHIP_LABEL_LOOKUP.set(alias.toLowerCase(), canonical);
  TOWNSHIP_TO_REGION.set(alias.toLowerCase(), region);
}

function normalizeRegionKey(value?: string): MyanmarRegion | undefined {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;
  const hit = REGION_LOOKUP.get(trimmed.toLowerCase());
  return hit;
}

/** Resolve checkout/admin region value to canonical English region key. */
export function resolveMyanmarRegionKey(value?: string): MyanmarRegion | undefined {
  return normalizeRegionKey(value);
}

/** Infer region when only a saved township/city is known. */
export function resolveMyanmarRegionForTownship(township?: string): MyanmarRegion | undefined {
  const trimmed = String(township || "").trim();
  if (!trimmed) return undefined;
  return TOWNSHIP_TO_REGION.get(trimmed.toLowerCase());
}

export function myanmarRegionSelectOptions(currentRegion?: string): string[] {
  const trimmed = String(currentRegion || "").trim();
  if (!trimmed) return [...MYANMAR_REGIONS];
  const known = normalizeRegionKey(trimmed);
  if (known) return [...MYANMAR_REGIONS];
  return [trimmed, ...MYANMAR_REGIONS];
}

/** Townships for a region; keeps unknown saved township when it does not match list yet. */
export function myanmarTownshipSelectOptions(
  region?: string,
  currentTownship?: string
): string[] {
  const regionKey = normalizeRegionKey(region);
  if (!regionKey) return [];

  const townships = [...REGION_TOWNSHIPS[regionKey]];
  const trimmed = String(currentTownship || "").trim();
  if (!trimmed) return townships;

  const inList = townships.some((t) => t.toLowerCase() === trimmed.toLowerCase());
  if (inList) return townships;
  return [trimmed, ...townships];
}

export function isTownshipInMyanmarRegion(region?: string, township?: string): boolean {
  const regionKey = normalizeRegionKey(region);
  const trimmed = String(township || "").trim();
  if (!regionKey || !trimmed) return false;
  return REGION_TOWNSHIPS[regionKey].some((t) => t.toLowerCase() === trimmed.toLowerCase());
}

/** Canonical English township key within a region (for logistics exception keys). */
export function normalizeTownshipKey(region?: string, township?: string): string | undefined {
  const regionKey = normalizeRegionKey(region);
  const trimmed = String(township || "").trim();
  if (!trimmed) return undefined;

  const aliased = resolveTownshipAlias(trimmed);
  const canonical =
    TOWNSHIP_LABEL_LOOKUP.get(aliased.toLowerCase()) ||
    TOWNSHIP_LABEL_LOOKUP.get(trimmed.toLowerCase());
  if (!canonical) return undefined;

  const lookupKey = TOWNSHIP_LABEL_LOOKUP.has(aliased.toLowerCase())
    ? aliased.toLowerCase()
    : trimmed.toLowerCase();
  const townshipRegion = TOWNSHIP_TO_REGION.get(lookupKey);
  if (regionKey && townshipRegion && townshipRegion !== regionKey) return undefined;

  return canonical;
}

/** Backward-compatible aliases used elsewhere. */
export const MYANMAR_STATES = MYANMAR_REGIONS;

export function myanmarStateSelectOptions(currentState?: string): string[] {
  return myanmarRegionSelectOptions(currentState);
}

export function myanmarCitySelectOptions(region?: string, currentCity?: string): string[] {
  return myanmarTownshipSelectOptions(region, currentCity);
}

/** All searchable tokens for a township (English, GAD aliases, Burmese when language is my). */
export function getMyanmarTownshipSearchTerms(
  township: string,
  language: "en" | "my" | "zh" = "en"
): string {
  const terms = new Set<string>([township]);
  for (const [alias, canonical] of Object.entries(TOWNSHIP_ALIASES)) {
    if (canonical === township) terms.add(alias);
  }
  if (language === "my") {
    const burmese =
      MYANMAR_TOWNSHIP_LABELS_MY[township as keyof typeof MYANMAR_TOWNSHIP_LABELS_MY];
    if (burmese) terms.add(burmese);
  }
  return [...terms].join(" ");
}
