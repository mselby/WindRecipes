// sketch.js — p5.js port of the Processing Beaufort Table sketch
//
// NOTE: loadJSON()/loadTable() need the page served over http(s), not
// opened directly as a file:// URL (the browser blocks local file
// reads for security). Test locally with something like:
//   python3 -m http.server
// then visit http://localhost:8000 — GitHub Pages serves over https
// automatically, so this is only a concern for local testing.

// ---- locations ----
// To add a place, add one entry to EACH of the three arrays below.
// Put your favourite places first: once the list is longer than
// LIST_ALL_UP_TO, only the first FEATURED_COUNT appear on the landing
// screen and the rest are reached through the search box.
let locationNames = ["Rotterdam", "London"];
let locationLat = [51.9225, 51.5074];
let locationLon = [4.4792, -0.1278];

const LIST_ALL_UP_TO = 6;
const FEATURED_COUNT = 4;
const SHOW_HINT = true; // small "tap for another poem" line on the poem screen

let currentLocation = -1; // -1 = landing screen (no location chosen yet)
let searchBox;
let hotspots = []; // clickable regions, rebuilt every frame in draw()

let lat, lon;
let windKMH;
let apiKey = "6dcffb3aadf6a599c8825754c22b67e1";

let table;
let fragments; // wind force -> pool of short, shuffled method fragments (fragments.json)
let currentSky = ""; // live sky description from the weather response
let currentSea = ""; // Beaufort "Sea State" wording for the current force
// chance that a poem gets an extra opening line about the sky or the sea
const EXTRA_CHANCE = 0.6;
let displayText = "…";
let bg;

// weather / poem state
let weatherReady = false; // true once we have a Beaufort match to compose from
let fetching = false;
let requestCounter = 0; // lets us ignore out-of-date weather responses
let currentWf = null;
let currentBeaufortText = "";

function preload() {
  // both of these block, same as Processing's loadJSONArray/loadTable —
  // fine here since preload() is specifically designed to wait
  fragments = loadJSON(
    "fragments.json",
    (data) => {
      console.log("fragments.json fetch succeeded, pools:", Object.keys(data).length);
    },
    (err) => {
      console.error("FAILED to load fragments.json:", err);
    }
  );
  table = loadTable("Beaufort.csv", "csv", "header");
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("Georgia"); // web-safe serif, no font file needed
  textAlign(CENTER, CENTER);

  console.log(table.getRowCount() + " total rows in table");
  const poolSizes = Object.keys(fragments).map((k) => k + ": " + fragments[k].length);
  console.log("Fragment pools -> " + poolSizes.join(", "));

  updateFooterHeight();
  buildSearchBox();
  showLandingScreen();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateFooterHeight();
  positionSearchBox();
}

// the credits line is real HTML at the bottom of the page; measure it so the
// poem screen's label and hint sit just above it instead of underneath
let footerHeight = 0;
function updateFooterHeight() {
  const el = document.getElementById("credits");
  footerHeight = el ? el.offsetHeight : 0;
}

// ---------------------------------------------------------------------
// Landing screen + location choosing
// ---------------------------------------------------------------------

function landingLayout() {
  const base = max(18, min(width, height) * 0.06);
  const nameSize = base * 0.9;
  const spacing = nameSize * 1.7;
  const headingY = height * 0.2;
  const firstNameY = headingY + base * 2.4;
  return { base, nameSize, spacing, headingY, firstNameY };
}

function visibleLocationCount() {
  return locationNames.length <= LIST_ALL_UP_TO ? locationNames.length : FEATURED_COUNT;
}

function searchNeeded() {
  return locationNames.length > LIST_ALL_UP_TO;
}

// native text input with autocomplete suggestions taken from locationNames
function buildSearchBox() {
  const list = createElement("datalist");
  list.id("place-list");
  for (const name of locationNames) {
    const opt = createElement("option");
    opt.attribute("value", name);
    list.child(opt);
  }

  searchBox = createInput("");
  searchBox.attribute("list", "place-list");
  searchBox.attribute("placeholder", "or search for a place");
  searchBox.attribute("autocomplete", "off");
  searchBox.style("box-sizing", "border-box");
  searchBox.style("font-family", "Georgia, serif");
  searchBox.style("font-size", "16px"); // 16px+ stops iOS zooming in when tapped
  searchBox.style("padding", "8px 12px");
  searchBox.style("text-align", "center");
  searchBox.style("color", "#ffff66");
  searchBox.style("background", "rgba(0, 0, 0, 0.55)");
  searchBox.style("border", "1px solid rgba(255, 255, 0, 0.6)");
  searchBox.style("border-radius", "4px");
  searchBox.style("outline", "none");
  searchBox.input(onSearchInput);
  searchBox.changed(onSearchChanged);
  searchBox.hide();
}

function positionSearchBox() {
  if (!searchBox) return;
  if (currentLocation !== -1 || !searchNeeded()) {
    searchBox.hide();
    return;
  }
  const L = landingLayout();
  const w = min(340, width * 0.8);
  const y = L.firstNameY + visibleLocationCount() * L.spacing;
  searchBox.size(w, 40);
  searchBox.position((width - w) / 2, y);
  searchBox.show();
}

// picks up an exact match as soon as it is typed or chosen from the suggestions
function onSearchInput() {
  const q = searchBox.value().trim().toLowerCase();
  const i = locationNames.findIndex((n) => n.toLowerCase() === q);
  if (i !== -1) chooseLocation(i);
}

// on Enter / leaving the field, accept the first partial match
function onSearchChanged() {
  const q = searchBox.value().trim().toLowerCase();
  if (!q) return;
  let i = locationNames.findIndex((n) => n.toLowerCase().startsWith(q));
  if (i === -1) i = locationNames.findIndex((n) => n.toLowerCase().includes(q));
  if (i !== -1) chooseLocation(i);
}

function showLandingScreen() {
  requestCounter++; // ignore any weather response still on its way
  fetching = false;
  weatherReady = false;
  currentLocation = -1;
  displayText = "Choose your location to generate a poem";

  // pick a random Beaufort scale image (forces 0-12) as backdrop
  const randomForce = Math.floor(Math.random() * 13);
  loadImage(
    "Beaufort_scale_" + randomForce + ".jpg",
    (img) => {
      bg = img;
    },
    () => {
      console.warn("No landing image found for force " + randomForce);
      bg = null;
    }
  );

  positionSearchBox();
}

function chooseLocation(i) {
  searchBox.value("");
  searchBox.elt.blur(); // dismiss the phone keyboard
  currentLocation = i;
  lat = locationLat[i];
  lon = locationLon[i];
  weatherReady = false;
  displayText = "…";
  positionSearchBox(); // hides it
  console.log("Chose: " + locationNames[i]);
  refreshForecast();
}

// ---------------------------------------------------------------------
// Weather -> Beaufort row -> poem
// ---------------------------------------------------------------------

// fires the weather request; the rest of the logic runs in gotWeather() once it returns
function refreshForecast() {
  const url =
    "https://api.openweathermap.org/data/2.5/weather?lat=" +
    lat +
    "&lon=" +
    lon +
    "&appid=" +
    apiKey;

  fetching = true;
  const myRequest = ++requestCounter;
  httpGet(
    url,
    "json",
    false,
    (data) => {
      if (myRequest === requestCounter) gotWeather(data);
    },
    (err) => {
      if (myRequest === requestCounter) gotWeatherError(err);
    }
  );
}

function gotWeatherError(err) {
  console.error("Weather fetch failed:", err);
  fetching = false;
  weatherReady = false; // tapping the screen will retry
  displayText = "COULD NOT REACH WEATHER DATA";
}

// runs once the weather response actually arrives (this is the async part)
function gotWeather(data) {
  fetching = false;
  windKMH = data.wind.speed * 3.6;
  console.log("windKMH: " + windKMH);

  const rounded = Math.round(windKMH); // avoid decimal gaps between integer-bound rows
  let match = null;
  let lowest = null;
  let highest = null;
  let smallestRangeStart = Infinity;

  for (let i = 0; i < table.getRowCount(); i++) {
    const row = table.getRow(i);
    const wfStr = row.getString("Wind Force");
    if (!wfStr || wfStr.trim() === "") continue; // skip blank/sub-header rows

    const wf = parseInt(wfStr, 10);
    if (isNaN(wf)) continue;

    // "Sea State" is the last column; guard it in case a row is short
    let sea = "";
    try {
      sea = row.getString("Sea State").trim();
    } catch (e) {}
    if (!/[a-zA-Z]{3}/.test(sea)) sea = ""; // ignore blanks, dashes and bare numbers
    sea = sea.replace(/\s*\(([^)]*)\)/g, ", $1"); // "Calm (glassy)" reads better as "calm, glassy"

    const entry = {
      wf: wf,
      desc: row.getString("Description"),
      spec: row.getString("Specifications"),
      sea: sea,
    };
    if (lowest === null || wf < lowest.wf) lowest = entry;
    if (highest === null || wf > highest.wf) highest = entry;

    const range = row.getString("km/h").split("-");
    if (range.length > 1) {
      const rangeStart = parseFloat(range[0]);
      const rangeEnd = parseFloat(range[1]);
      smallestRangeStart = Math.min(smallestRangeStart, rangeStart);
      if (rounded >= rangeStart && rounded <= rangeEnd) match = entry;
    }
  }

  // the calmest and stormiest rows aren't written as "a-b" ranges, so a very
  // light or very strong wind would otherwise match nothing at all
  if (match === null) {
    match = rounded < smallestRangeStart ? lowest : highest;
  }
  if (match === null) {
    gotWeatherError("no usable rows in Beaufort.csv");
    return;
  }

  currentWf = match.wf;
  // no force number in here, so it never shows up in the poem
  currentBeaufortText = match.desc + ". " + match.spec;
  currentSea = match.sea;
  currentSky =
    data.weather && data.weather[0] && data.weather[0].description
      ? String(data.weather[0].description).trim()
      : "";
  console.log(match.wf + " : " + currentBeaufortText);

  loadImage(
    "Beaufort_scale_" + match.wf + ".jpg",
    (img) => {
      bg = img;
    },
    () => {
      console.warn("No image found for wind force " + match.wf);
      bg = null;
    }
  );

  weatherReady = true;
  composePoem();
}

// the pool of fragments for a wind force: exact match first, then (for the
// calm forces 0-1) the "in harbour" pool, then the nearest lower force
function fragmentPool(wf) {
  const exact = fragments[String(wf)];
  if (exact && exact.length) return exact;

  if (wf <= 1 && fragments["harbour"] && fragments["harbour"].length) {
    return fragments["harbour"];
  }

  let best = null;
  for (const key of Object.keys(fragments)) {
    const k = parseInt(key, 10);
    if (!isNaN(k) && k <= wf && fragments[key].length && (best === null || k > best)) best = k;
  }
  return best === null ? null : fragments[String(best)];
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// builds a fresh poem from the weather we already have (no network needed),
// so tapping the screen can re-roll it as often as you like
function composePoem() {
  const pool = fragmentPool(currentWf);
  if (pool === null) {
    console.warn("No fragments for wind force " + currentWf + " or below — check fragments.json.");
  }

  const beaufortFrag = pickOne(splitTokens(currentBeaufortText, ".,;")).trim();
  const recipeFrag = pool === null ? "no recipe available for this wind force" : pickOne(pool);

  const parts = [beaufortFrag, recipeFrag];

  // sometimes open with a line about today's sky or the sea state
  const extras = [currentSky, currentSea].filter((s) => s && s.length > 0);
  if (extras.length > 0 && Math.random() < EXTRA_CHANCE) {
    parts.unshift(pickOne(extras));
  }

  // no stray brackets in the poem
  displayText = parts
    .map((p) => p.replace(/[()]/g, "").trim().toLowerCase())
    .join("; ");
}

// splits on ".", "," or ";" — equivalent to Processing's splitTokens(str, ".,;")
function splitTokens(str, delimiters) {
  const escaped = delimiters.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return str.split(new RegExp("[" + escaped + "]")).filter((s) => s.trim().length > 0);
}

// ---------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------

function pointInside(h, px, py) {
  return px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h;
}

// On a phone, one tap used to count twice: p5 treats the touch as a press, and
// then the browser sends a second, copied "mouse click" when you lift your finger.
// So touches are handled on their own (and the copy is blocked), and any mouse
// event that arrives just after a touch is ignored.
let lastTouchTime = -10000;

function isCanvasEvent(event) {
  // p5 also reports presses on the search box; only react to the canvas itself
  return !(event && event.target && event.target.tagName && event.target.tagName.toLowerCase() !== "canvas");
}

function handlePress() {
  for (const h of hotspots) {
    if (pointInside(h, mouseX, mouseY)) {
      h.action();
      return;
    }
  }

  // tap anywhere else on a poem: another poem for the same place
  // (or a retry, if the weather could not be fetched)
  if (currentLocation !== -1) {
    if (weatherReady) composePoem();
    else if (!fetching) refreshForecast();
  }
}

function touchStarted(event) {
  if (!isCanvasEvent(event)) return; // leave the search box alone so it works normally
  lastTouchTime = millis();
  handlePress();
  return false; // stops the browser sending its copied mouse click
}

function touchEnded(event) {
  lastTouchTime = millis();
  if (!isCanvasEvent(event)) return;
  return false;
}

function mousePressed(event) {
  if (!isCanvasEvent(event)) return;
  if (millis() - lastTouchTime < 1000) return; // the browser's copy of a touch
  handlePress();
}

// ---------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------

// draws an image scaled to fill the whole canvas without distortion,
// cropping the edges that overflow (like CSS object-fit: cover)
function drawCover(img) {
  const canvasRatio = width / height;
  const imgRatio = img.width / img.height;

  let drawW, drawH;
  if (imgRatio > canvasRatio) {
    // image is wider than the canvas: match height, crop the sides
    drawH = height;
    drawW = height * imgRatio;
  } else {
    // image is taller than the canvas: match width, crop top/bottom
    drawW = width;
    drawH = width / imgRatio;
  }

  // center it
  const x = (width - drawW) / 2;
  const y = (height - drawH) / 2;
  image(img, x, y, drawW, drawH);
}

// text with a soft drop shadow, inside a box
function shadowText(str, x, y, w, h, r, g, b) {
  fill(0);
  text(str, x + 2, y + 2, w, h);
  fill(r, g, b);
  text(str, x, y, w, h);
}

function drawLanding() {
  const L = landingLayout();
  const margin = 30;

  // heading
  textSize(L.base);
  shadowText(displayText, margin, L.headingY - L.base * 1.5, width - margin * 2, L.base * 3, 255, 255, 0);

  // place names, each one a tappable hotspot
  textSize(L.nameSize);
  const count = visibleLocationCount();
  for (let i = 0; i < count; i++) {
    const cy = L.firstNameY + i * L.spacing;
    const w = textWidth(locationNames[i]) + L.nameSize * 1.5;
    const hot = { x: width / 2 - w / 2, y: cy - L.spacing / 2, w: w, h: L.spacing, action: () => chooseLocation(i) };
    hotspots.push(hot);

    const hovering = pointInside(hot, mouseX, mouseY);
    if (hovering) shadowText(locationNames[i], 0, cy - L.spacing / 2, width, L.spacing, 255, 255, 255);
    else shadowText(locationNames[i], 0, cy - L.spacing / 2, width, L.spacing, 255, 255, 0);
  }
}

function drawPoem() {
  const base = max(18, min(width, height) * 0.06);
  const margin = 30;

  textSize(base);
  shadowText(displayText, margin, margin, width - margin * 2, height - margin * 2, 255, 255, 0);

  // small label: the current place, tappable to go back to choosing
  // place name, plus the Beaufort force once the weather has arrived
  const label =
    "‹  " + locationNames[currentLocation] + (weatherReady ? "  ·  Force " + currentWf : "");
  textSize(16);
  const w = textWidth(label) + 28;
  const h = 36;
  const cx = width / 2;
  const cy = height - footerHeight - 30;
  const hot = { x: cx - w / 2, y: cy - h / 2, w: w, h: h, action: showLandingScreen };
  hotspots.push(hot);

  fill(255, pointInside(hot, mouseX, mouseY) ? 255 : 190);
  text(label, cx, cy);

  if (SHOW_HINT) {
    textSize(12);
    fill(255, 120);
    text("tap anywhere for another poem", cx, cy - 26);
  }
}

function draw() {
  background(0);

  if (bg) {
    drawCover(bg);

    // dark overlay: hides softness in the image and helps the text stand out
    noStroke();
    fill(0, 110); // second number is opacity, 0-255
    rect(0, 0, width, height);
  }

  hotspots = [];
  if (currentLocation === -1) drawLanding();
  else drawPoem();

  // hand cursor over anything you can click on a desktop
  const overHotspot = hotspots.some((h) => pointInside(h, mouseX, mouseY));
  cursor(overHotspot ? HAND : ARROW);
}
