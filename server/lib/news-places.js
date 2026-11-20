/**
 * Where a news story is about, read from its own words.
 *
 * The Situation Room puts a story on the map only where its headline or
 * summary names a place: a country, one of its well-known cities, or its
 * people ("Ukrainian", "Brazilian"). Keys are the country names in
 * world-atlas's Natural Earth 1:110m topology (the same map the lens draws),
 * so text and map always agree. Nothing is inferred beyond what is written:
 *
 *  - basis "mentioned": the text names the place.
 *  - basis "outlet": the feed says which country the outlet is based in.
 *    That is where it was reported from, not where it happened, and the lens
 *    says so. It is only used when the text names nowhere.
 *  - otherwise the story is unplaced, and listed as such.
 *
 * Words that are also common names or other things ("Jordan", "Chad",
 * "Georgia", "Turkey", "Niger"…) only count with an unambiguous companion
 * term in the same text (its capital, its demonym), so a basketball player
 * or a US state does not light up a country.
 */

/** @type {Record<string, { names: string[], people?: string[], cities?: string[], ambiguous?: boolean }>} */
export const PLACES = {
  "Afghanistan": { names: ["Afghanistan"], people: ["Afghan", "Afghans"], cities: ["Kabul", "Kandahar", "Herat"] },
  "Albania": { names: ["Albania"], people: ["Albanian"], cities: ["Tirana"] },
  "Algeria": { names: ["Algeria"], people: ["Algerian"], cities: ["Algiers"] },
  "Angola": { names: ["Angola"], people: ["Angolan"], cities: ["Luanda"] },
  "Antarctica": { names: ["Antarctica", "Antarctic"] },
  "Argentina": { names: ["Argentina"], people: ["Argentine", "Argentinian"], cities: ["Buenos Aires"] },
  "Armenia": { names: ["Armenia"], people: ["Armenian"], cities: ["Yerevan"] },
  "Australia": { names: ["Australia"], people: ["Australian", "Australians"], cities: ["Sydney", "Melbourne", "Canberra", "Brisbane", "Perth"] },
  "Austria": { names: ["Austria"], people: ["Austrian"], cities: ["Vienna"] },
  "Azerbaijan": { names: ["Azerbaijan"], people: ["Azerbaijani", "Azeri"], cities: ["Baku"] },
  "Bahamas": { names: ["Bahamas"], people: ["Bahamian"], cities: ["Nassau"] },
  "Bangladesh": { names: ["Bangladesh"], people: ["Bangladeshi"], cities: ["Dhaka"] },
  "Belarus": { names: ["Belarus"], people: ["Belarusian"], cities: ["Minsk"] },
  "Belgium": { names: ["Belgium"], people: ["Belgian"], cities: ["Brussels", "Antwerp"] },
  "Belize": { names: ["Belize"] },
  "Benin": { names: ["Benin"], people: ["Beninese"], cities: ["Cotonou", "Porto-Novo"] },
  "Bhutan": { names: ["Bhutan"], people: ["Bhutanese"], cities: ["Thimphu"] },
  "Bolivia": { names: ["Bolivia"], people: ["Bolivian"], cities: ["La Paz", "Sucre"] },
  "Bosnia and Herz.": { names: ["Bosnia and Herzegovina", "Bosnia"], people: ["Bosnian"], cities: ["Sarajevo"] },
  "Botswana": { names: ["Botswana"], cities: ["Gaborone"] },
  "Brazil": { names: ["Brazil"], people: ["Brazilian", "Brazilians"], cities: ["Brasilia", "Brasília", "Sao Paulo", "São Paulo", "Rio de Janeiro"] },
  "Brunei": { names: ["Brunei"] },
  "Bulgaria": { names: ["Bulgaria"], people: ["Bulgarian"], cities: ["Sofia"] },
  "Burkina Faso": { names: ["Burkina Faso"], people: ["Burkinabe"], cities: ["Ouagadougou"] },
  "Burundi": { names: ["Burundi"], people: ["Burundian"], cities: ["Gitega", "Bujumbura"] },
  "Cambodia": { names: ["Cambodia"], people: ["Cambodian"], cities: ["Phnom Penh"] },
  "Cameroon": { names: ["Cameroon"], people: ["Cameroonian"], cities: ["Yaounde", "Yaoundé", "Douala"] },
  "Canada": { names: ["Canada"], people: ["Canadian", "Canadians"], cities: ["Ottawa", "Toronto", "Montreal", "Vancouver"] },
  "Central African Rep.": { names: ["Central African Republic"], cities: ["Bangui"] },
  "Chad": { names: ["Chad"], people: ["Chadian"], cities: ["N'Djamena"], ambiguous: true },
  "Chile": { names: ["Chile"], people: ["Chilean"], cities: ["Santiago"] },
  "China": { names: ["China", "PRC"], people: ["Chinese"], cities: ["Beijing", "Shanghai", "Shenzhen", "Hong Kong", "Wuhan", "Guangzhou"] },
  "Colombia": { names: ["Colombia"], people: ["Colombian"], cities: ["Bogota", "Bogotá", "Medellin", "Medellín"] },
  "Congo": { names: ["Republic of the Congo", "Congo-Brazzaville"], cities: ["Brazzaville"] },
  "Costa Rica": { names: ["Costa Rica"], people: ["Costa Rican"], cities: ["San Jose"] },
  "Croatia": { names: ["Croatia"], people: ["Croatian"], cities: ["Zagreb"] },
  "Cuba": { names: ["Cuba"], people: ["Cuban"], cities: ["Havana"] },
  "Cyprus": { names: ["Cyprus"], people: ["Cypriot"], cities: ["Nicosia"] },
  "Czechia": { names: ["Czechia", "Czech Republic"], people: ["Czech"], cities: ["Prague"] },
  "Côte d'Ivoire": { names: ["Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast"], people: ["Ivorian"], cities: ["Abidjan", "Yamoussoukro"] },
  "Dem. Rep. Congo": { names: ["Democratic Republic of the Congo", "DR Congo", "DRC"], people: ["Congolese"], cities: ["Kinshasa", "Goma"] },
  "Denmark": { names: ["Denmark"], people: ["Danish", "Dane", "Danes"], cities: ["Copenhagen"] },
  "Djibouti": { names: ["Djibouti"] },
  "Dominican Rep.": { names: ["Dominican Republic"], people: ["Dominican"], cities: ["Santo Domingo"] },
  "Ecuador": { names: ["Ecuador"], people: ["Ecuadorian"], cities: ["Quito", "Guayaquil"] },
  "Egypt": { names: ["Egypt"], people: ["Egyptian", "Egyptians"], cities: ["Cairo", "Alexandria"] },
  "El Salvador": { names: ["El Salvador"], people: ["Salvadoran"], cities: ["San Salvador"] },
  "Eq. Guinea": { names: ["Equatorial Guinea"], cities: ["Malabo"] },
  "Eritrea": { names: ["Eritrea"], people: ["Eritrean"], cities: ["Asmara"] },
  "Estonia": { names: ["Estonia"], people: ["Estonian"], cities: ["Tallinn"] },
  "Ethiopia": { names: ["Ethiopia"], people: ["Ethiopian"], cities: ["Addis Ababa"] },
  "Falkland Is.": { names: ["Falkland Islands", "Falklands"] },
  "Fiji": { names: ["Fiji"], people: ["Fijian"], cities: ["Suva"] },
  "Finland": { names: ["Finland"], people: ["Finnish", "Finns"], cities: ["Helsinki"] },
  "Fr. S. Antarctic Lands": { names: ["French Southern and Antarctic Lands"] },
  "France": { names: ["France"], people: ["French"], cities: ["Paris", "Marseille", "Lyon"] },
  "Gabon": { names: ["Gabon"], people: ["Gabonese"], cities: ["Libreville"] },
  "Gambia": { names: ["Gambia"], people: ["Gambian"], cities: ["Banjul"] },
  "Georgia": { names: ["Georgia"], people: ["Georgian"], cities: ["Tbilisi"], ambiguous: true },
  "Germany": { names: ["Germany"], people: ["German", "Germans"], cities: ["Berlin", "Munich", "Frankfurt", "Hamburg"] },
  "Ghana": { names: ["Ghana"], people: ["Ghanaian"], cities: ["Accra"] },
  "Greece": { names: ["Greece"], people: ["Greek"], cities: ["Athens"] },
  "Greenland": { names: ["Greenland"], cities: ["Nuuk"] },
  "Guatemala": { names: ["Guatemala"], people: ["Guatemalan"] },
  "Guinea": { names: ["Guinea"], people: ["Guinean"], cities: ["Conakry"] },
  "Guinea-Bissau": { names: ["Guinea-Bissau"], cities: ["Bissau"] },
  "Guyana": { names: ["Guyana"], people: ["Guyanese"], cities: ["Georgetown"] },
  "Haiti": { names: ["Haiti"], people: ["Haitian"], cities: ["Port-au-Prince"] },
  "Honduras": { names: ["Honduras"], people: ["Honduran"], cities: ["Tegucigalpa"] },
  "Hungary": { names: ["Hungary"], people: ["Hungarian"], cities: ["Budapest"] },
  "Iceland": { names: ["Iceland"], people: ["Icelandic"], cities: ["Reykjavik"] },
  "India": { names: ["India"], people: ["Indian", "Indians"], cities: ["New Delhi", "Delhi", "Mumbai", "Bengaluru", "Bangalore", "Kolkata", "Chennai"] },
  "Indonesia": { names: ["Indonesia"], people: ["Indonesian"], cities: ["Jakarta", "Bali"] },
  "Iran": { names: ["Iran"], people: ["Iranian", "Iranians"], cities: ["Tehran"] },
  "Iraq": { names: ["Iraq"], people: ["Iraqi", "Iraqis"], cities: ["Baghdad", "Mosul", "Basra", "Erbil"] },
  "Ireland": { names: ["Ireland"], people: ["Irish"], cities: ["Dublin"] },
  "Israel": { names: ["Israel"], people: ["Israeli", "Israelis"], cities: ["Jerusalem", "Tel Aviv"] },
  "Italy": { names: ["Italy"], people: ["Italian", "Italians"], cities: ["Rome", "Milan", "Naples"] },
  "Jamaica": { names: ["Jamaica"], people: ["Jamaican"], cities: ["Kingston"] },
  "Japan": { names: ["Japan"], people: ["Japanese"], cities: ["Tokyo", "Osaka", "Kyoto"] },
  "Jordan": { names: ["Jordan"], people: ["Jordanian"], cities: ["Amman"], ambiguous: true },
  "Kazakhstan": { names: ["Kazakhstan"], people: ["Kazakh"], cities: ["Astana", "Almaty"] },
  "Kenya": { names: ["Kenya"], people: ["Kenyan", "Kenyans"], cities: ["Nairobi", "Mombasa"] },
  "Kosovo": { names: ["Kosovo"], people: ["Kosovar"], cities: ["Pristina"] },
  "Kuwait": { names: ["Kuwait"], people: ["Kuwaiti"] },
  "Kyrgyzstan": { names: ["Kyrgyzstan"], people: ["Kyrgyz"], cities: ["Bishkek"] },
  "Laos": { names: ["Laos"], people: ["Laotian"], cities: ["Vientiane"] },
  "Latvia": { names: ["Latvia"], people: ["Latvian"], cities: ["Riga"] },
  "Lebanon": { names: ["Lebanon"], people: ["Lebanese"], cities: ["Beirut"] },
  "Lesotho": { names: ["Lesotho"], cities: ["Maseru"] },
  "Liberia": { names: ["Liberia"], people: ["Liberian"], cities: ["Monrovia"] },
  "Libya": { names: ["Libya"], people: ["Libyan"], cities: ["Tripoli", "Benghazi"] },
  "Lithuania": { names: ["Lithuania"], people: ["Lithuanian"], cities: ["Vilnius"] },
  "Luxembourg": { names: ["Luxembourg"] },
  "Macedonia": { names: ["North Macedonia", "Macedonia"], people: ["Macedonian"], cities: ["Skopje"] },
  "Madagascar": { names: ["Madagascar"], people: ["Malagasy"], cities: ["Antananarivo"] },
  "Malawi": { names: ["Malawi"], people: ["Malawian"], cities: ["Lilongwe"] },
  "Malaysia": { names: ["Malaysia"], people: ["Malaysian"], cities: ["Kuala Lumpur"] },
  "Mali": { names: ["Mali"], people: ["Malian"], cities: ["Bamako", "Timbuktu"] },
  "Mauritania": { names: ["Mauritania"], people: ["Mauritanian"], cities: ["Nouakchott"] },
  "Mexico": { names: ["Mexico"], people: ["Mexican", "Mexicans"], cities: ["Mexico City", "Guadalajara", "Monterrey", "Tijuana"] },
  "Moldova": { names: ["Moldova"], people: ["Moldovan"], cities: ["Chisinau"] },
  "Mongolia": { names: ["Mongolia"], people: ["Mongolian"], cities: ["Ulaanbaatar"] },
  "Montenegro": { names: ["Montenegro"], cities: ["Podgorica"] },
  "Morocco": { names: ["Morocco"], people: ["Moroccan"], cities: ["Rabat", "Casablanca", "Marrakech"] },
  "Mozambique": { names: ["Mozambique"], people: ["Mozambican"], cities: ["Maputo"] },
  "Myanmar": { names: ["Myanmar", "Burma"], people: ["Burmese"], cities: ["Naypyidaw", "Yangon"] },
  "N. Cyprus": { names: ["Northern Cyprus"] },
  "Namibia": { names: ["Namibia"], people: ["Namibian"], cities: ["Windhoek"] },
  "Nepal": { names: ["Nepal"], people: ["Nepali", "Nepalese"], cities: ["Kathmandu"] },
  "Netherlands": { names: ["Netherlands", "Holland"], people: ["Dutch"], cities: ["Amsterdam", "The Hague", "Rotterdam"] },
  "New Caledonia": { names: ["New Caledonia"], cities: ["Noumea", "Nouméa"] },
  "New Zealand": { names: ["New Zealand"], people: ["New Zealander", "Kiwi"], cities: ["Wellington", "Auckland"] },
  "Nicaragua": { names: ["Nicaragua"], people: ["Nicaraguan"], cities: ["Managua"] },
  "Niger": { names: ["Niger"], people: ["Nigerien"], cities: ["Niamey"], ambiguous: true },
  "Nigeria": { names: ["Nigeria"], people: ["Nigerian", "Nigerians"], cities: ["Abuja", "Lagos", "Kano"] },
  "North Korea": { names: ["North Korea", "DPRK"], people: ["North Korean"], cities: ["Pyongyang"] },
  "Norway": { names: ["Norway"], people: ["Norwegian"], cities: ["Oslo"] },
  "Oman": { names: ["Oman"], people: ["Omani"], cities: ["Muscat"] },
  "Pakistan": { names: ["Pakistan"], people: ["Pakistani", "Pakistanis"], cities: ["Islamabad", "Karachi", "Lahore"] },
  "Palestine": { names: ["Palestine", "Palestinian territories", "Gaza", "Gaza Strip", "West Bank"], people: ["Palestinian", "Palestinians"], cities: ["Ramallah", "Rafah", "Khan Younis"] },
  "Panama": { names: ["Panama"], people: ["Panamanian"] },
  "Papua New Guinea": { names: ["Papua New Guinea"], cities: ["Port Moresby"] },
  "Paraguay": { names: ["Paraguay"], people: ["Paraguayan"], cities: ["Asuncion", "Asunción"] },
  "Peru": { names: ["Peru"], people: ["Peruvian"], cities: ["Lima"] },
  "Philippines": { names: ["Philippines"], people: ["Filipino", "Filipinos", "Philippine"], cities: ["Manila", "Quezon City", "Cebu", "Davao"] },
  "Poland": { names: ["Poland"], people: ["Polish", "Poles"], cities: ["Warsaw", "Krakow", "Kraków"] },
  "Portugal": { names: ["Portugal"], people: ["Portuguese"], cities: ["Lisbon", "Porto"] },
  "Puerto Rico": { names: ["Puerto Rico"], people: ["Puerto Rican"], cities: ["San Juan"] },
  "Qatar": { names: ["Qatar"], people: ["Qatari"], cities: ["Doha"] },
  "Romania": { names: ["Romania"], people: ["Romanian"], cities: ["Bucharest"] },
  "Russia": { names: ["Russia", "Russian Federation"], people: ["Russian", "Russians"], cities: ["Moscow", "St Petersburg", "St. Petersburg", "Kremlin"] },
  "Rwanda": { names: ["Rwanda"], people: ["Rwandan"], cities: ["Kigali"] },
  "S. Sudan": { names: ["South Sudan"], people: ["South Sudanese"], cities: ["Juba"] },
  "Saudi Arabia": { names: ["Saudi Arabia"], people: ["Saudi", "Saudis"], cities: ["Riyadh", "Jeddah", "Mecca"] },
  "Senegal": { names: ["Senegal"], people: ["Senegalese"], cities: ["Dakar"] },
  "Serbia": { names: ["Serbia"], people: ["Serbian", "Serb", "Serbs"], cities: ["Belgrade"] },
  "Sierra Leone": { names: ["Sierra Leone"], cities: ["Freetown"] },
  "Slovakia": { names: ["Slovakia"], people: ["Slovak"], cities: ["Bratislava"] },
  "Slovenia": { names: ["Slovenia"], people: ["Slovenian"], cities: ["Ljubljana"] },
  "Solomon Is.": { names: ["Solomon Islands"], cities: ["Honiara"] },
  "Somalia": { names: ["Somalia"], people: ["Somali", "Somalis"], cities: ["Mogadishu"] },
  "Somaliland": { names: ["Somaliland"], cities: ["Hargeisa"] },
  "South Africa": { names: ["South Africa"], people: ["South African", "South Africans"], cities: ["Johannesburg", "Cape Town", "Pretoria", "Durban"] },
  "South Korea": { names: ["South Korea", "Republic of Korea"], people: ["South Korean", "South Koreans"], cities: ["Seoul", "Busan"] },
  "Spain": { names: ["Spain"], people: ["Spanish", "Spaniard", "Spaniards"], cities: ["Madrid", "Barcelona", "Valencia", "Seville"] },
  "Sri Lanka": { names: ["Sri Lanka"], people: ["Sri Lankan"], cities: ["Colombo"] },
  "Sudan": { names: ["Sudan"], people: ["Sudanese"], cities: ["Khartoum", "Darfur", "Port Sudan"] },
  "Suriname": { names: ["Suriname"], cities: ["Paramaribo"] },
  "Sweden": { names: ["Sweden"], people: ["Swedish", "Swede", "Swedes"], cities: ["Stockholm", "Gothenburg"] },
  "Switzerland": { names: ["Switzerland"], people: ["Swiss"], cities: ["Geneva", "Zurich", "Zürich", "Bern", "Davos"] },
  "Syria": { names: ["Syria"], people: ["Syrian", "Syrians"], cities: ["Damascus", "Aleppo", "Idlib"] },
  "Taiwan": { names: ["Taiwan"], people: ["Taiwanese"], cities: ["Taipei"] },
  "Tajikistan": { names: ["Tajikistan"], people: ["Tajik"], cities: ["Dushanbe"] },
  "Tanzania": { names: ["Tanzania"], people: ["Tanzanian"], cities: ["Dodoma", "Dar es Salaam", "Zanzibar"] },
  "Thailand": { names: ["Thailand"], people: ["Thai"], cities: ["Bangkok", "Phuket"] },
  "Timor-Leste": { names: ["Timor-Leste", "East Timor"], cities: ["Dili"] },
  "Togo": { names: ["Togo"], people: ["Togolese"], cities: ["Lome", "Lomé"] },
  "Trinidad and Tobago": { names: ["Trinidad and Tobago", "Trinidad"], cities: ["Port of Spain"] },
  "Tunisia": { names: ["Tunisia"], people: ["Tunisian"], cities: ["Tunis"] },
  "Turkey": { names: ["Turkey", "Türkiye", "Turkiye"], people: ["Turkish", "Turks"], cities: ["Ankara", "Istanbul", "Izmir"], ambiguous: true },
  "Turkmenistan": { names: ["Turkmenistan"], people: ["Turkmen"], cities: ["Ashgabat"] },
  "Uganda": { names: ["Uganda"], people: ["Ugandan"], cities: ["Kampala"] },
  "Ukraine": { names: ["Ukraine"], people: ["Ukrainian", "Ukrainians"], cities: ["Kyiv", "Kiev", "Kharkiv", "Odesa", "Odessa", "Lviv", "Donbas", "Crimea"] },
  "United Arab Emirates": { names: ["United Arab Emirates", "UAE"], people: ["Emirati"], cities: ["Dubai", "Abu Dhabi"] },
  "United Kingdom": { names: ["United Kingdom", "Britain", "Great Britain", "UK", "U.K.", "England", "Scotland", "Wales", "Northern Ireland"], people: ["British", "Briton", "Britons", "English", "Scottish", "Welsh"], cities: ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Belfast", "Downing Street", "Westminster"] },
  "United States of America": { names: ["United States", "USA", "U.S.A.", "US", "U.S.", "America"], people: ["American", "Americans"], cities: ["Washington", "New York", "Los Angeles", "Chicago", "San Francisco", "Houston", "White House", "Pentagon", "Capitol Hill", "Silicon Valley", "Wall Street"] },
  "Uruguay": { names: ["Uruguay"], people: ["Uruguayan"], cities: ["Montevideo"] },
  "Uzbekistan": { names: ["Uzbekistan"], people: ["Uzbek"], cities: ["Tashkent", "Samarkand"] },
  "Vanuatu": { names: ["Vanuatu"], cities: ["Port Vila"] },
  "Venezuela": { names: ["Venezuela"], people: ["Venezuelan", "Venezuelans"], cities: ["Caracas", "Maracaibo"] },
  "Vietnam": { names: ["Vietnam", "Viet Nam"], people: ["Vietnamese"], cities: ["Hanoi", "Ho Chi Minh City", "Saigon"] },
  "W. Sahara": { names: ["Western Sahara"], cities: ["Laayoune"] },
  "Yemen": { names: ["Yemen"], people: ["Yemeni", "Houthi", "Houthis"], cities: ["Sanaa", "Sana'a", "Aden", "Hodeidah"] },
  "Zambia": { names: ["Zambia"], people: ["Zambian"], cities: ["Lusaka"] },
  "Zimbabwe": { names: ["Zimbabwe"], people: ["Zimbabwean"], cities: ["Harare"] },
  "eSwatini": { names: ["Eswatini", "eSwatini", "Swaziland"], people: ["Swazi"], cities: ["Mbabane"] },
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One matcher per term. Terms are case-sensitive (place names are proper
// nouns: "US" the country, not "us" the pronoun) and bounded so "Indian"
// does not match inside "Indiana" and "Mali" not inside "Somalia".
const MATCHERS = [];
for (const [key, p] of Object.entries(PLACES)) {
  const add = (term, kind) => MATCHERS.push({ key, term, kind, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, "u") });
  for (const n of p.names) add(n, "name");
  for (const n of p.people || []) add(n, "people");
  for (const n of p.cities || []) add(n, "city");
}
// Longer terms first, so "South Sudan" claims its words before "Sudan",
// "New Delhi" before "Delhi", "Northern Ireland" before "Ireland".
MATCHERS.sort((a, b) => b.term.length - a.term.length);

/**
 * Places a text names.
 * @param {string} text
 * @returns {{ key: string, terms: string[] }[]} world-atlas names, in order of first mention
 */
export function placesIn(text) {
  let rest = String(text || "");
  if (!rest.trim()) return [];
  const hits = new Map(); // key -> { first, terms:Set, kinds:Set }
  for (const m of MATCHERS) {
    const found = m.re.exec(rest);
    if (!found) continue;
    const h = hits.get(m.key) || { first: found.index, terms: new Set(), kinds: new Set() };
    h.first = Math.min(h.first, found.index);
    h.terms.add(m.term);
    h.kinds.add(m.kind);
    hits.set(m.key, h);
    // Blank the matched span so a shorter term cannot claim it again.
    rest = rest.slice(0, found.index) + " ".repeat(found[0].length) + rest.slice(found.index + found[0].length);
  }
  const out = [];
  for (const [key, h] of hits) {
    // An ambiguous country counts only when more than its bare name is present.
    if (PLACES[key].ambiguous && h.kinds.size === 1 && h.kinds.has("name")) continue;
    out.push({ key, first: h.first, terms: [...h.terms] });
  }
  return out.sort((a, b) => a.first - b.first).map(({ key, terms }) => ({ key, terms }));
}

/** The world-atlas name for a feed's sourceCountry string ("United States", "Russia"…), or null. */
export function countryKey(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  if (PLACES[n]) return n;
  const lower = n.toLowerCase();
  for (const [key, p] of Object.entries(PLACES)) {
    if (p.names.some((x) => x.toLowerCase() === lower)) return key;
  }
  return null;
}

export default { PLACES, placesIn, countryKey };
