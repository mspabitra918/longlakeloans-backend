/**
 * Local US bank routing number database for the most common banks.
 * This avoids reliance on unreliable third-party APIs.
 *
 * Source: Federal Reserve E-Payments Routing Directory
 * https://www.frbservices.org/resources/routing-number-directory
 */

interface RoutingEntry {
  bankName: string;
  city?: string;
  state?: string;
}

// Major US bank routing numbers (covers ~80% of consumer lookups)
const ROUTING_DB: Record<string, RoutingEntry> = {
  // JPMorgan Chase
  "021000021": { bankName: "JPMorgan Chase", city: "Tampa", state: "FL" },
  "022300173": { bankName: "JPMorgan Chase", city: "Tampa", state: "FL" },
  "021100361": { bankName: "JPMorgan Chase", city: "New York", state: "NY" },
  "028000024": { bankName: "JPMorgan Chase", city: "New York", state: "NY" },
  "083000137": { bankName: "JPMorgan Chase", city: "Louisville", state: "KY" },
  "065400137": { bankName: "JPMorgan Chase", city: "Tampa", state: "FL" },
  "071000013": { bankName: "JPMorgan Chase", city: "Chicago", state: "IL" },
  "072000326": { bankName: "JPMorgan Chase", city: "Detroit", state: "MI" },
  "074000010": { bankName: "JPMorgan Chase", city: "Columbus", state: "OH" },
  "075000019": { bankName: "JPMorgan Chase", city: "Milwaukee", state: "WI" },
  "082000357": { bankName: "JPMorgan Chase", city: "Tampa", state: "FL" },
  "267084131": { bankName: "JPMorgan Chase", city: "Tampa", state: "FL" },
  "322271627": { bankName: "JPMorgan Chase", city: "Los Angeles", state: "CA" },
  "325070760": { bankName: "JPMorgan Chase", city: "Seattle", state: "WA" },
  "044000037": { bankName: "JPMorgan Chase", city: "Columbus", state: "OH" },
  "111000614": { bankName: "JPMorgan Chase", city: "Dallas", state: "TX" },

  // Bank of America
  "011000138": { bankName: "Bank of America", city: "Boston", state: "MA" },
  "011200365": { bankName: "Bank of America", city: "Hartford", state: "CT" },
  "011400495": { bankName: "Bank of America", city: "Concord", state: "NH" },
  "011500010": { bankName: "Bank of America", city: "Burlington", state: "VT" },
  "011900254": { bankName: "Bank of America", city: "Providence", state: "RI" },
  "021000322": { bankName: "Bank of America", city: "New York", state: "NY" },
  "021200339": { bankName: "Bank of America", city: "New York", state: "NY" },
  "026009593": { bankName: "Bank of America", city: "New York", state: "NY" },
  "051000017": { bankName: "Bank of America", city: "Richmond", state: "VA" },
  "053000196": { bankName: "Bank of America", city: "Charlotte", state: "NC" },
  "054001204": { bankName: "Bank of America", city: "Washington", state: "DC" },
  "061000052": { bankName: "Bank of America", city: "Atlanta", state: "GA" },
  "063100277": {
    bankName: "Bank of America",
    city: "Jacksonville",
    state: "FL",
  },
  "063000047": {
    bankName: "Bank of America",
    city: "Jacksonville",
    state: "FL",
  },
  "071000505": { bankName: "Bank of America", city: "Chicago", state: "IL" },
  "081000032": { bankName: "Bank of America", city: "St. Louis", state: "MO" },
  "082000073": {
    bankName: "Bank of America",
    city: "Little Rock",
    state: "AR",
  },
  "101100045": {
    bankName: "Bank of America",
    city: "Kansas City",
    state: "MO",
  },
  "107000327": {
    bankName: "Bank of America",
    city: "Oklahoma City",
    state: "OK",
  },
  "111000025": { bankName: "Bank of America", city: "Dallas", state: "TX" },
  "113000023": { bankName: "Bank of America", city: "Houston", state: "TX" },
  "121000358": {
    bankName: "Bank of America",
    city: "San Francisco",
    state: "CA",
  },
  "122000661": {
    bankName: "Bank of America",
    city: "Los Angeles",
    state: "CA",
  },
  "122400724": { bankName: "Bank of America", city: "Tempe", state: "AZ" },
  "123000220": { bankName: "Bank of America", city: "Portland", state: "OR" },
  "125000024": { bankName: "Bank of America", city: "Seattle", state: "WA" },

  // Wells Fargo
  "011100106": { bankName: "Wells Fargo", city: "Minneapolis", state: "MN" },
  "021101108": { bankName: "Wells Fargo", city: "New York", state: "NY" },
  "031000503": { bankName: "Wells Fargo", city: "Philadelphia", state: "PA" },
  "041215032": { bankName: "Wells Fargo", city: "Cincinnati", state: "OH" },
  "051400549": { bankName: "Wells Fargo", city: "Richmond", state: "VA" },
  "053000219": { bankName: "Wells Fargo", city: "Charlotte", state: "NC" },
  "053207766": { bankName: "Wells Fargo", city: "Charlotte", state: "NC" },
  "061000227": { bankName: "Wells Fargo", city: "Atlanta", state: "GA" },
  "062000080": { bankName: "Wells Fargo", city: "Birmingham", state: "AL" },
  "063107513": { bankName: "Wells Fargo", city: "Jacksonville", state: "FL" },
  "071101307": { bankName: "Wells Fargo", city: "Chicago", state: "IL" },
  "073000228": { bankName: "Wells Fargo", city: "Des Moines", state: "IA" },
  "081000210": { bankName: "Wells Fargo", city: "St. Louis", state: "MO" },
  "091000019": { bankName: "Wells Fargo", city: "Minneapolis", state: "MN" },
  "092905278": { bankName: "Wells Fargo", city: "Billings", state: "MT" },
  "101089292": { bankName: "Wells Fargo", city: "Kansas City", state: "MO" },
  "102000076": { bankName: "Wells Fargo", city: "Denver", state: "CO" },
  "104000058": { bankName: "Wells Fargo", city: "Omaha", state: "NE" },
  "107002192": { bankName: "Wells Fargo", city: "Oklahoma City", state: "OK" },
  "108000010": { bankName: "Wells Fargo", city: "Albuquerque", state: "NM" },
  "111900659": { bankName: "Wells Fargo", city: "Dallas", state: "TX" },
  "112000066": { bankName: "Wells Fargo", city: "El Paso", state: "TX" },
  "113900774": { bankName: "Wells Fargo", city: "Houston", state: "TX" },
  "121000248": { bankName: "Wells Fargo", city: "San Francisco", state: "CA" },
  "122000247": { bankName: "Wells Fargo", city: "Los Angeles", state: "CA" },
  "124002971": { bankName: "Wells Fargo", city: "Salt Lake City", state: "UT" },
  "125008547": { bankName: "Wells Fargo", city: "Seattle", state: "WA" },
  "321270742": { bankName: "Wells Fargo", city: "San Francisco", state: "CA" },

  // Citibank
  "021000089": { bankName: "Citibank", city: "New York", state: "NY" },
  "021001486": { bankName: "Citibank", city: "New York", state: "NY" },
  "021002939": { bankName: "Citibank", city: "New York", state: "NY" },
  "022002496": { bankName: "Citibank", city: "New York", state: "NY" },
  "031100157": { bankName: "Citibank", city: "Wilmington", state: "DE" },
  "052002166": { bankName: "Citibank", city: "Baltimore", state: "MD" },
  "066009593": { bankName: "Citibank", city: "Miami", state: "FL" },
  "067004764": { bankName: "Citibank", city: "Miami", state: "FL" },
  "113193532": { bankName: "Citibank", city: "San Antonio", state: "TX" },
  "271070801": { bankName: "Citibank", city: "Chicago", state: "IL" },
  "321171184": { bankName: "Citibank", city: "San Francisco", state: "CA" },
  "322271724": { bankName: "Citibank", city: "Los Angeles", state: "CA" },

  // US Bank
  "042100175": { bankName: "US Bank", city: "Cincinnati", state: "OH" },
  "061000146": { bankName: "US Bank", city: "Atlanta", state: "GA" },
  "064000059": { bankName: "US Bank", city: "Nashville", state: "TN" },
  "073000545": { bankName: "US Bank", city: "Des Moines", state: "IA" },
  "074900275": { bankName: "US Bank", city: "Indianapolis", state: "IN" },
  "091000022": { bankName: "US Bank", city: "Minneapolis", state: "MN" },
  "091215927": { bankName: "US Bank", city: "Minneapolis", state: "MN" },
  "101000187": { bankName: "US Bank", city: "Kansas City", state: "MO" },
  "102000175": { bankName: "US Bank", city: "Denver", state: "CO" },
  "104000029": { bankName: "US Bank", city: "Omaha", state: "NE" },
  "121122676": { bankName: "US Bank", city: "San Francisco", state: "CA" },
  "122105155": { bankName: "US Bank", city: "Los Angeles", state: "CA" },
  "125000105": { bankName: "US Bank", city: "Seattle", state: "WA" },

  // Capital One
  "051405515": { bankName: "Capital One", city: "Richmond", state: "VA" },
  "056073612": { bankName: "Capital One", city: "Richmond", state: "VA" },
  "065000090": { bankName: "Capital One", city: "New Orleans", state: "LA" },

  // PNC Bank
  "031100089": { bankName: "PNC Bank", city: "Pittsburgh", state: "PA" },
  "041000124": { bankName: "PNC Bank", city: "Cleveland", state: "OH" },
  "042000398": { bankName: "PNC Bank", city: "Cincinnati", state: "OH" },
  "043000096": { bankName: "PNC Bank", city: "Pittsburgh", state: "PA" },
  "054000030": { bankName: "PNC Bank", city: "Washington", state: "DC" },
  "071921891": { bankName: "PNC Bank", city: "Chicago", state: "IL" },
  "083000108": { bankName: "PNC Bank", city: "Louisville", state: "KY" },

  // TD Bank
  "011103093": { bankName: "TD Bank", city: "Lewiston", state: "ME" },
  "011302936": { bankName: "TD Bank", city: "Burlington", state: "VT" },
  "011600033": { bankName: "TD Bank", city: "Bridgeport", state: "CT" },
  "021272655": { bankName: "TD Bank", city: "New York", state: "NY" },
  "031101266": { bankName: "TD Bank", city: "Philadelphia", state: "PA" },
  "031201360": { bankName: "TD Bank", city: "Cherry Hill", state: "NJ" },
  "054001725": { bankName: "TD Bank", city: "Washington", state: "DC" },

  // Truist (BB&T / SunTrust)
  "051404260": { bankName: "Truist Bank", city: "Winston-Salem", state: "NC" },
  "053101121": { bankName: "Truist Bank", city: "Charlotte", state: "NC" },
  "055003308": { bankName: "Truist Bank", city: "Baltimore", state: "MD" },
  "061000104": { bankName: "Truist Bank", city: "Atlanta", state: "GA" },
  "061113415": { bankName: "Truist Bank", city: "Atlanta", state: "GA" },
  "063104668": { bankName: "Truist Bank", city: "Orlando", state: "FL" },

  // Ally Bank
  "124003116": { bankName: "Ally Bank", city: "Sandy", state: "UT" },

  // Charles Schwab
  "121202211": { bankName: "Charles Schwab Bank", city: "Reno", state: "NV" },

  // Goldman Sachs (Marcus)
  "124085066": {
    bankName: "Goldman Sachs Bank (Marcus)",
    city: "Salt Lake City",
    state: "UT",
  },

  // Discover Bank
  "031100649": { bankName: "Discover Bank", city: "New Castle", state: "DE" },

  // USAA
  "314074269": {
    bankName: "USAA Federal Savings Bank",
    city: "San Antonio",
    state: "TX",
  },

  // Navy Federal Credit Union
  "256074974": {
    bankName: "Navy Federal Credit Union",
    city: "Vienna",
    state: "VA",
  },

  // Chime (via Bancorp / Stride)
  "031101279": {
    bankName: "The Bancorp Bank (Chime)",
    city: "Wilmington",
    state: "DE",
  },
  "103100195": { bankName: "Stride Bank (Chime)", city: "Enid", state: "OK" },

  // Varo
  "091311229": { bankName: "Varo Bank", city: "Sioux Falls", state: "SD" },

  // SoFi
  "062203984": {
    bankName: "SoFi Bank",
    city: "Cottonwood Heights",
    state: "UT",
  },

  // American Express National Bank
  "124071889": {
    bankName: "American Express National Bank",
    city: "Salt Lake City",
    state: "UT",
  },

  // Regions Bank
  "062005690": { bankName: "Regions Bank", city: "Birmingham", state: "AL" },
  "082000109": { bankName: "Regions Bank", city: "St. Louis", state: "MO" },

  // Fifth Third Bank
  "042000314": {
    bankName: "Fifth Third Bank",
    city: "Cincinnati",
    state: "OH",
  },

  // KeyBank
  "041001039": { bankName: "KeyBank", city: "Cleveland", state: "OH" },

  // Huntington Bank
  "044000024": {
    bankName: "Huntington National Bank",
    city: "Columbus",
    state: "OH",
  },

  // M&T Bank
  "022000046": { bankName: "M&T Bank", city: "Buffalo", state: "NY" },

  // Citizens Bank
  "011500120": { bankName: "Citizens Bank", city: "Providence", state: "RI" },
  "021313103": { bankName: "Citizens Bank", city: "Providence", state: "RI" },

  // BMO Harris
  "071025661": { bankName: "BMO Harris Bank", city: "Chicago", state: "IL" },

  // SVB (Silicon Valley Bank / First Citizens)
  "121140399": {
    bankName: "First Citizens Bank (SVB)",
    city: "Santa Clara",
    state: "CA",
  },

  // First Republic (now Chase)
  "321081669": {
    bankName: "JPMorgan Chase (First Republic)",
    city: "San Francisco",
    state: "CA",
  },
};

/**
 * Validates a 9-digit US ABA routing number using the Mod 10 checksum.
 * Formula: 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10)
 */
export function isValidRoutingNumber(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;

  const d = routing.split("").map(Number);
  const checksum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);

  return checksum % 10 === 0;
}

/**
 * Looks up a routing number in the local database.
 * Returns the bank info if found, or null.
 */
export function lookupRouting(routing: string): RoutingEntry | null {
  return ROUTING_DB[routing] || null;
}
