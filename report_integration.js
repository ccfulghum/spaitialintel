
/* ==========================================
   DEMOGRAPHIC REPORT GENERATOR - CSV VERSION
   - Reads from texas_blockgroup_demographics_2022.csv instead of Census API
   - Uses Turf.js for spatial analysis (loaded via CDN)
   - html2canvas optional (for map snapshot)
   - Uses MAX radius once, then breaks out smaller radii
   ========================================== */

/* -----------------------------
   GLOBALS
------------------------------ */

// Global variable to store loaded block group data
let blockGroupData = null;

// Global variable to store CSV demographic data indexed by GEOID
let demographicDataByGeoid = null;

// Global variable to store ACS percentage values (employment, education, occupation)
let acsPctDataByGeoid = null;


// script.js (frontend)

async function generateReport(data) {
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const report = await response.json();
  console.log(report);
}



/* ----------------------------------------------------
   0) INIT: Load Block Group GeoJSON and CSV on page load
----------------------------------------------------- */
async function loadBlockGroupData() {
  try {
    console.log("Loading block group GeoJSON data...");

    // Try both .json and .geojson extensions
    let response = await fetch("bgZTCA_TX.json");
    if (!response.ok) {
      response = await fetch("bgZTCA_TX.geojson");
    }

    if (!response.ok) {
      throw new Error(`Failed to load bgZTCA_TX file: ${response.status}`);
    }

    blockGroupData = await response.json();
    console.log(`✓ Successfully loaded ${blockGroupData.features.length} block groups with ZCTAs`);
    return blockGroupData;
  } catch (error) {
    console.error("Error loading block group data:", error);
    alert(
      "Error: Could not load block group data file (bgZTCA_TX.json or bgZTCA_TX.geojson). " +
        "Make sure it is in the same directory as the HTML file."
    );
    throw error;
  }
}


// async function downloadPDF() {
//   const iframe = document.getElementById('report-iframe');
//   const doc = iframe.contentDocument;
  
//   // Use html2pdf or similar library
//   const opt = {
//     margin: 0.5,
//     filename: 'demographic-report.pdf',
//     html2canvas: { scale: 2 },
//     jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
//   };
  
//   html2pdf().set(opt).from(doc.body).save();
// }


function downloadPDF() {
  var element = document.getElementById('pdf-root');
  html2pdf()
    .set({
      margin: 0.5, filename: 'demographic-market-report.pdf',
      html2canvas: {
        scale: 2, useCORS: true, scrollX: 0, scrollY: 0, x: 0, y: 0, windowWidth: 816,
        onclone: function(doc) {
          doc.documentElement.style.width = '816px';
          doc.documentElement.style.margin = '0'; doc.documentElement.style.padding = '0';
          var b = doc.body;
          b.style.width = '816px'; b.style.margin = '0'; b.style.padding = '0';
          b.style.transform = 'none'; b.style.zoom = '1'; b.style.overflow = 'visible'; b.style.background = 'white';
          var r = doc.getElementById('pdf-root');
          if (r) { r.style.width = '100%'; r.style.margin = '0'; r.style.padding = '0'; }
          doc.querySelectorAll('.page').forEach(function(p) {
            p.style.width = '100%'; p.style.maxWidth = '100%'; p.style.margin = '0'; p.style.padding = '0';
          });
          var btn = doc.getElementById('download-btn');
          if (btn) btn.style.display = 'none';
        }
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['css','legacy'], before: '.page', avoid: ['table','.stat-card','.chart-container','.info-box'] }
    })
    .from(element).save();
}

async function loadDemographicCSV() {
  try {
    console.log("Loading demographic CSV data...");

    const response = await fetch("texas_blockgroup_demographics_2022.csv");
    if (!response.ok) {
      throw new Error(`Failed to load CSV file: ${response.status}`);
    }

    const csvText = await response.text();
    demographicDataByGeoid = parseCSVToGeoidMap(csvText);
    
    console.log(`✓ Successfully loaded demographics for ${demographicDataByGeoid.size} block groups`);
    return demographicDataByGeoid;
  } catch (error) {
    console.error("Error loading demographic CSV:", error);
    alert(
      "Error: Could not load texas_blockgroup_demographics_2022.csv. " +
        "Make sure it is in the same directory as the HTML file."
    );
    throw error;
  }
}



/* ----------------------------------------------------
   LOAD ACS PERCENTAGE VALUES CSV
   File: ACS_pct_values_by_blockgroup.csv
   Expected columns (pct_ prefix = pre-calculated):
     GEOID, pct_labor_force, pct_unemployed,
     pct_bachelors_plus, pct_hs_plus, pct_mgmt_occ
----------------------------------------------------- */
async function loadAcsPctCSV() {
  try {
    console.log("Loading ACS percentage values CSV...");
    const response = await fetch("ACS_pct_values_by_blockgroup.csv");
    if (!response.ok) {
      throw new Error(`Failed to load ACS pct CSV: ${response.status}`);
    }
    const csvText = await response.text();
    acsPctDataByGeoid = parseAcsPctCSV(csvText);
    console.log(`✓ Loaded ACS pct data for ${acsPctDataByGeoid.size} block groups`);
    return acsPctDataByGeoid;
  } catch (error) {
    console.error("Error loading ACS pct CSV:", error);
    // Non-fatal — employment section will show fallback values
    acsPctDataByGeoid = new Map();
    return acsPctDataByGeoid;
  }
}

/**
 * Parse ACS_pct_values_by_blockgroup.csv into a Map keyed by GEOID.
 * Handles both full 12-digit GEOIDs and component columns
 * (state, county, tract, block group).
 */
/**
 * Parse ACS_pct_values_by_blockgroup.csv
 *
 * Expected columns (exact names from your CSV):
 *   state, county, tract, block group, NAME,
 *   labor_force_participation_rate,
 *   unemployment_rate,
 *   bachelors_or_higher_rate,
 *   high_school_or_higher_rate,
 *   professional_mgmt_occ_rate
 *
 * Values are already percentages (e.g. 63.81 = 63.81%).
 * GEOID is built from state+county+tract+block group components.
 * Aggregation uses simple average across block groups in radius
 * (population-weighted average via the population from the main CSV).
 */
function parseAcsPctCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const pctMap = new Map();

  // Helper: find column index (case-insensitive, trimmed)
  const col = (name) => rawHeaders.findIndex(
    h => h.toLowerCase().trim() === name.toLowerCase().trim()
  );

  // GEOID component columns
  const idxState  = col('state');
  const idxCounty = col('county');
  const idxTract  = col('tract');
  const idxBG     = col('block group');
  const idxGeoid  = col('GEOID'); // optional fallback

  // Rate columns — exact names from your CSV header
  const idxLaborForce      = col('labor_force_participation_rate');
  const idxUnemployment    = col('unemployment_rate');
  const idxBachelors       = col('bachelors_or_higher_rate');
  const idxHS              = col('high_school_or_higher_rate');
  const idxMgmt            = col('professional_mgmt_occ_rate');

  // National benchmark columns — same value on every row, read once from row 1
  const idxNatlLaborForce   = col('natl_labor_force_participation_rate');
  const idxNatlUnemployment = col('natl_unemployment_rate');
  const idxNatlBachelors    = col('natl_bachelors_or_higher_rate');
  const idxNatlHS           = col('natl_high_school_or_higher_rate');
  const idxNatlMgmt         = col('natl_professional_mgmt_occ_rate');

  console.log('ACS pct CSV columns detected:', {
    state: idxState, county: idxCounty, tract: idxTract, bg: idxBG,
    laborForce: idxLaborForce, unemployment: idxUnemployment,
    bachelors: idxBachelors, hs: idxHS, mgmt: idxMgmt
  });

  const toNum = (v) => {
    if (v === undefined || v === null) return 0;
    const s = v.toString().replace(/^"|"$/g, '').trim();
    if (s === '' || s === '-666666666' || s === 'null' || s === 'N/A') return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted CSV fields (e.g. NAME column contains commas)
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') {
        inQuotes = !inQuotes;
      } else if (line[c] === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += line[c];
      }
    }
    values.push(current.trim()); // last field

    // Build 12-digit GEOID: state(2) + county(3) + tract(6) + BG(1)
    let geoid = '';
    if (idxGeoid !== -1 && values[idxGeoid]) {
      geoid = values[idxGeoid].replace(/[^0-9]/g, '');
    }
    if (!geoid && idxState !== -1) {
      const st = (values[idxState] || '').padStart(2, '0');
      const co = (values[idxCounty] || '').padStart(3, '0');
      // Tract: remove decimal, pad to 6 digits
      const rawTract = (values[idxTract] || '').replace('.', '');
      const tr = rawTract.padStart(6, '0');
      const bg = (values[idxBG] || '').trim();
      geoid = `${st}${co}${tr}${bg}`;
    }

    // Must be at least 11 digits to be a valid block group GEOID
    if (!geoid || geoid.length < 11) {
      console.warn(`ACS pct CSV row ${i}: could not build valid GEOID`, values.slice(0,5));
      continue;
    }

    pctMap.set(geoid, {
      laborForceRate:    toNum(values[idxLaborForce]),
      unemploymentRate:  toNum(values[idxUnemployment]),
      bachelorsRate:     toNum(values[idxBachelors]),
      hsRate:            toNum(values[idxHS]),
      mgmtRate:          toNum(values[idxMgmt]),
      // National values — identical on every row; stored for easy retrieval
      natlLaborForce:    toNum(values[idxNatlLaborForce]),
      natlUnemployment:  toNum(values[idxNatlUnemployment]),
      natlBachelors:     toNum(values[idxNatlBachelors]),
      natlHS:            toNum(values[idxNatlHS]),
      natlMgmt:          toNum(values[idxNatlMgmt]),
    });
  }

  console.log(`✓ Parsed ${pctMap.size} block groups from ACS pct CSV`);
  return pctMap;
}

// Main function to fetch urgent care counts
async function fetchAllFacilityCounts() {
    try {
        console.log('Starting urgent care facility fetch...');
        const addressElement = document.getElementById('report-address');
        const address = addressElement ? addressElement.textContent.trim() : null;
        if (!address || address === 'Address') { showError('all'); return; }
        const location = await geocodeAddress(address);
        if (!location) { showError('all'); return; }
        const radius = 24140;
        const urgentCareResults = await searchPlaces(location, 'urgent care', radius);
        updateFacilityCount('comp-urgent-care', urgentCareResults.length, 'sat-urgent-care', 'opp-urgent-care');
        console.log('✓ Urgent care count updated');
    } catch (error) {
        console.error('Error fetching facility counts:', error);
        showError('all');
    }
}



// Geocode address to lat/lng
function geocodeAddress(address) {
    return new Promise((resolve, reject) => {
        geocoder.geocode({ address: address }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                resolve(location);
            } else {
                console.error('Geocoding failed:', status);
                reject(new Error(`Geocoding failed: ${status}`));
            }
        });
    });
}

// Search for places using Google Places API
function searchPlaces(location, keyword, radius) {
    return new Promise((resolve, reject) => {
        const request = {
            location: location,
            radius: radius,
            keyword: keyword
        };
        
        placesService.nearbySearch(request, (results, status, pagination) => {
            if (status === google.maps.places.PlacesServiceStatus.OK) {
                let totalResults = results.length;
                
                // Check if there are more pages of results
                if (pagination && pagination.hasNextPage) {
                    // For simplicity, we'll just count the first page
                    // In production, you might want to fetch all pages
                    console.log(`Found ${totalResults}+ ${keyword} (additional pages available)`);
                }
                
                resolve(totalResults);
            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                resolve(0);
            } else {
                console.error(`Places search failed for "${keyword}":`, status);
                reject(new Error(`Places search failed: ${status}`));
            }
        });
    });
}

// Update facility count in DOM and calculate saturation
function updateFacilityCount(countId, count, saturationId, opportunityId) {
    const countElement = document.getElementById(countId);
    const satElement = document.getElementById(saturationId);
    const oppElement = document.getElementById(opportunityId);
    
    if (countElement) {
        countElement.textContent = count;
        countElement.className = ''; // Remove loading class
    }
    
    // Calculate saturation and opportunity based on count
    if (satElement && oppElement) {
        const { saturation, opportunity } = calculateMarketMetrics(count);
        satElement.textContent = saturation;
        oppElement.textContent = opportunity;
    }
}



// Calculate market saturation and opportunity based on facility count
function calculateMarketMetrics(count) {
    let saturation, opportunity;
    
    if (count === 0) {
        saturation = 'None';
        opportunity = 'Very High';
    } else if (count <= 5) {
        saturation = 'Low';
        opportunity = 'High';
    } else if (count <= 15) {
        saturation = 'Moderate';
        opportunity = 'Moderate';
    } else if (count <= 25) {
        saturation = 'Moderate-High';
        opportunity = 'Low-Moderate';
    } else {
        saturation = 'High';
        opportunity = 'Low';
    }
    
    return { saturation, opportunity };
}

// Show error state
function showError(type) {
    const ids = type === 'all' ? ['comp-urgent-care'] : [type];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = 'Error'; el.className = ''; el.style.color = '#dc3545'; }
    });
}

// Fallback: populate detail table in iframe doc (no rating)
function populateFacilityDetailTable(doc, tableId, places) {
    const table = doc.getElementById(tableId);
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!places || places.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No results found</td></tr>';
        return;
    }
    places.forEach(function(place, idx) {
        const tr = doc.createElement('tr');
        tr.innerHTML =
            '<td>' + (idx + 1) + '</td>' +
            '<td>' + (place.name || 'Unknown') + '</td>' +
            '<td>' + (place.address || 'N/A') + '</td>';
        tbody.appendChild(tr);
    });
}

/**
 * Parse CSV text and create a Map indexed by GEOID
 * Returns: Map<GEOID, demographicRecord>
 */
function parseCSVToGeoidMap(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  
  const geoidMap = new Map();
  
  // Find column indices
  const getIndex = (name) => headers.indexOf(name);
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    
    // Build GEOID from state, county, tract, block group
    const state = values[getIndex('state')];
    const county = values[getIndex('county')];
    const tract = values[getIndex('tract')];
    const blockGroup = values[getIndex('block group')];
    const geoid = `${state}${county}${tract}${blockGroup}`;
    
    // Create record object with all variables
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = values[j];
      
      // Convert to number if it's a numeric column (starts with B, ends with _curr/_prior, or is a calculated field)
      if (header.startsWith('B') || 
          header.endsWith('_curr') || 
          header.endsWith('_prior') ||
          header.startsWith('age_') ||
          header.startsWith('change_') ||
          header.startsWith('CAGR_') ||
          header.endsWith('_proj') ||
          ['homeownership_rate', 'pop_proj', 'hh_proj', 'fam_proj', 'med_inc_proj', 'per_capita_proj'].includes(header)) {
        const num = parseFloat(value);
        record[header] = (isNaN(num) || value === '-666666666') ? 0 : num;
      } else {
        record[header] = value;
      }
    }
    
    geoidMap.set(geoid, record);
  }
  
  return geoidMap;
}

// Initialize by loading data when page loads
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", async () => {
    console.log("Page loaded, initializing data loaders...");
    try {
      await Promise.all([
        loadBlockGroupData(),
        loadDemographicCSV(),
        loadAcsPctCSV()
      ]);
      console.log("✓ All data loaded successfully");
    } catch (error) {
      console.error("Failed to load data on page load:", error);
    }
  });
}

/* ----------------------------------------------------
   1) RADII: Get radii from sidebar sliders
----------------------------------------------------- */
function getRadiiFromSidebar() {
  try {
    const radii = [];
    for (let i = 1; i <= 3; i++) {
      const slider = document.getElementById(`radius${i}`);
      if (slider && parseInt(slider.value, 10) > 0) {
        radii.push(parseInt(slider.value, 10));
      }
    }
    return radii.length > 0 ? radii : [1, 3, 5];
  } catch (error) {
    console.error("Error getting radii from sidebar:", error);
    return [1, 3, 5];
  }
}

/*added in to get full address*/
async function getCurrentAddress() {
    const zip = document.getElementById('zip-code').innerText;
    if (zip === '—') return { address: 'Address Not Available', lat: null, lng: null };
    
    try {
        // Use coordinates from map center instead of ZIP for better results
        const center = map.getCenter();
        const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${center.lat()},${center.lng()}&key=${CONFIG.GOOGLE_MAPS_API_KEY}`
        );
        const data = await res.json();
        
        const fullAddress = data.results[0]?.formatted_address;
        
        return {
            address: fullAddress || 'Address Not Available',
            lat: center.lat(),
            lng: center.lng()
        };
    } catch (error) {
        console.error('Geocoding error:', error);
        return { address: 'Address Not Available', lat: null, lng: null };
    }
}


/**
 * Calculate median household income for county and state
 * Returns aggregated income data from all block groups
 */
function calculateCountyAndStateIncome(geoids, perGeoid) {
  let totalIncome = 0;
  let incomeCount = 0;
  const countyCodes = new Set();
  const stateCodes = new Set();
  
  // Aggregate median incomes and extract geographic codes
  for (const geoid of geoids) {
    const d = perGeoid.get(geoid);
    if (!d) continue;
    
    // Extract state (first 2 digits) and county (next 3 digits) from GEOID
    if (geoid.length >= 5) {
      stateCodes.add(geoid.substring(0, 2));
      countyCodes.add(geoid.substring(0, 5)); // state+county
    }
    
    if (d.medianIncome && d.medianIncome > 0) {
      totalIncome += d.medianIncome;
      incomeCount++;
    }
  }
  
  const avgMedianIncome = incomeCount > 0 ? Math.round(totalIncome / incomeCount) : 0;
  
  return {
    countyMedianIncome: avgMedianIncome,
    stateMedianIncome: avgMedianIncome, // Same calculation from local data
    stateCode: Array.from(stateCodes)[0] || '48', // Default to Texas (48)
    countyCode: Array.from(countyCodes)[0] || '48113', // Default
    formattedCounty: formatCurrency(avgMedianIncome),
    formattedState: formatCurrency(avgMedianIncome)
  };
}

/**
 * Format currency for display
 */
function formatCurrency(value) {
  if (value >= 1000000) {
    return "$" + (value / 1000000).toFixed(1) + "M";
  } else if (value >= 1000) {
    return "$" + (value / 1000).toFixed(1) + "K";
  } else {
    return "$" + value;
  }
}




/* =========================================================
   6) REPORT TEMPLATE POPULATION
   ========================================================= */

function populateReportTemplate(address, demographicData, facilityCounts, mapImageUrl, radii) {
  const reportIframe = document.getElementById("report-iframe");
  if (!reportIframe) {
    console.error("report-iframe not found");
    return;
  }

  const reportSection = document.getElementById("report-section");
  if (reportSection) reportSection.style.display = "block";

  const populateData = () => {
    setTimeout(() => {
      const doc = reportIframe.contentDocument || reportIframe.contentWindow.document;

      // Basic info
      setIfExists(doc, "report-address", address);
      setIfExists(doc, "report-date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }));

      // Map — static snapshot image (already set by generateMapSnapshot)
      const mapImg = doc.getElementById("report-map-image");
      if (mapImg) mapImg.src = mapImageUrl;

      // Also inject live map if iframe has initReportMap available
      try {
        const iframeWin = reportIframe.contentWindow;
        if (iframeWin && typeof iframeWin.initReportMap === 'function') {
          const center = (typeof map !== 'undefined' && map.getCenter) ? map.getCenter() : null;
          if (center) {
            iframeWin.initReportMap(center.lat(), center.lng(), radii, map.getZoom ? map.getZoom() : 12);
          }
        }
      } catch(e) {
        // cross-origin or map not ready — static image fallback is sufficient
      }

      // Facilities — URGENT CARE ONLY
      setIfExists(doc, "comp-urgent-care", facilityCounts.urgentCare ?? "N/A");

      const updateSatOpp = (countId, satId, oppId, count) => {
        const { saturation, opportunity } = calculateMarketMetrics(count);
        setIfExists(doc, satId, saturation);
        setIfExists(doc, oppId, opportunity);
      };
      updateSatOpp("comp-urgent-care", "sat-urgent-care", "opp-urgent-care", facilityCounts.urgentCare || 0);

      // ===== URGENT CARE DETAIL TABLE + NUMBERED MAP =====
      const iframeWindow = reportIframe.contentWindow;
      const ucDetails = facilityCounts.urgentCareDetails || [];
      const cLat = facilityCounts.centerLat;
      const cLng = facilityCounts.centerLng;

      // Detail table
      if (iframeWindow && typeof iframeWindow.populateFacilityTable === 'function') {
        iframeWindow.populateFacilityTable('detail-urgent-care', ucDetails);
      } else {
        populateFacilityDetailTable(doc, 'detail-urgent-care', ucDetails);
      }

      // Numbered-marker map — needs google.maps in iframe
      if (iframeWindow && typeof iframeWindow.buildUrgentCareMap === 'function' && cLat && cLng) {
        // Wait a tick for iframe's google.maps to be ready
        setTimeout(() => {
          try { iframeWindow.buildUrgentCareMap(ucDetails, cLat, cLng); }
          catch(e) { console.warn('UC map error:', e); }
        }, 500);
      }

      // ===== THEMATIC MAPS =====
      try {
        if (iframeWindow && typeof iframeWindow.buildThematicMap === 'function'
            && blockGroupData && blockGroupData.features && demographicDataByGeoid) {

          const thematicRadii = normalizeRadii(radii);
          const { allGeoids } = getBlockGroupsByRadius(cLat, cLng, thematicRadii);
          const perGeoid = getCSVDataForGeoids(allGeoids);

          const relevantFeatures = blockGroupData.features.filter(function(f) {
            return f.properties && allGeoids.includes(f.properties.GEOID);
          });

          // Delay to ensure iframe google.maps is initialized
          setTimeout(() => {
            try {
              iframeWindow.buildThematicMap(
                'thematic-income-map', 'income-map-placeholder',
                relevantFeatures, perGeoid, 'medianIncome',
                ['#ffffcc','#c7e9b4','#7fcdbb','#41b6c4','#1d91c0','#225ea8','#0c2c84'],
                cLat, cLng
              );
              iframeWindow.buildThematicMap(
                'thematic-pop-map', 'pop-map-placeholder',
                relevantFeatures, perGeoid, 'population',
                ['#fee5d9','#fcbba1','#fc9272','#fb6a4a','#ef3b2c','#cb181d','#67000d'],
                cLat, cLng
              );
              console.log('✓ Thematic maps built with', relevantFeatures.length, 'block groups');
            } catch(e) { console.warn('Thematic map render error:', e); }
          }, 800);
        }
      } catch (thematicError) {
        console.warn('Thematic maps could not be built:', thematicError);
      }

      // Demographics
      populateAllDemographics(doc, demographicData, radii);

      console.log("Report template populated");
    }, 1000);
  };

  const checkAndPopulate = () => {
    if (reportIframe.contentDocument) {
      const readyState = reportIframe.contentDocument.readyState;
      console.log("Iframe readyState:", readyState);
      if (readyState === "complete") populateData();
      else reportIframe.contentDocument.addEventListener("DOMContentLoaded", populateData);
    } else {
      reportIframe.onload = populateData;
    }
  };

  checkAndPopulate();
}

/**
 * Fetch ALL nearby places within the radius by looping through all API pages.
 * Google Places API returns max 20 per page, up to 3 pages = 60 results max.
 * Each subsequent page requires a 2-second delay (API requirement).
 */
async function fetchNearbyPlaces(lat, lng, radiusMiles, searchType) {
  // Resolve the Google Maps map instance — must be a google.maps.Map, not a DOM element
  let mapInstance = (typeof map !== 'undefined' && map instanceof google.maps.Map) ? map : null;

  // If no valid map instance, create a hidden one specifically for Places queries
  if (!mapInstance) {
    const hiddenDiv = document.createElement('div');
    document.body.appendChild(hiddenDiv);
    mapInstance = new google.maps.Map(hiddenDiv, {
      center: { lat, lng },
      zoom: 12
    });
  }

  const service     = new google.maps.places.PlacesService(mapInstance);
  const radiusMeters = radiusMiles * 1609.34;

  const queries = {
    'urgent_care': 'urgent care',
    'hospital':    'hospital',
    'specialty':   'dermatology clinic',
    'autism':      'autism center'
  };

  const query = queries[searchType] || searchType;
  let allResults = [];

  // Helper: fetch one page, returns { results, pagination }
  const fetchPage = (request) => new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`Places page timeout for "${query}"`);
      resolve({ results: [], pagination: null });
    }, 10000);

    service.textSearch(request, (results, status, pagination) => {
      clearTimeout(timeout);
      if (status === 'OK') {
        resolve({ results: results || [], pagination });
      } else {
        console.warn(`Places textSearch "${query}" page status:`, status);
        resolve({ results: [], pagination: null });
      }
    });
  });

  // Page 1 — initial request
  const page1 = await fetchPage({
    location: { lat, lng },
    radius:   radiusMeters,
    query:    query
  });
  allResults = allResults.concat(page1.results);
  console.log(`Places "${query}" page 1: ${page1.results.length} results`);

  // Page 2 — if available (Google requires ~2 sec delay between pages)
  if (page1.pagination && page1.pagination.hasNextPage) {
    await new Promise(r => setTimeout(r, 2000));
    const page2 = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ results: [], pagination: null }), 10000);
      page1.pagination.nextPage((results, status, pagination) => {
        clearTimeout(timeout);
        resolve(status === 'OK' ? { results: results || [], pagination } : { results: [], pagination: null });
      });
    });
    allResults = allResults.concat(page2.results);
    console.log(`Places "${query}" page 2: ${page2.results.length} results`);

    // Page 3 — if available
    if (page2.pagination && page2.pagination.hasNextPage) {
      await new Promise(r => setTimeout(r, 2000));
      const page3 = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ results: [], pagination: null }), 10000);
        page2.pagination.nextPage((results, status) => {
          clearTimeout(timeout);
          resolve(status === 'OK' ? { results: results || [], pagination: null } : { results: [], pagination: null });
        });
      });
      allResults = allResults.concat(page3.results);
      console.log(`Places "${query}" page 3: ${page3.results.length} results`);
    }
  }

  console.log(`✓ Places "${query}" TOTAL: ${allResults.length} results within ${radiusMiles} miles`);
  return allResults;
}
/* ----------------------------------------------------
   ADDED: GET COUNTY / STATE GEOGRAPHY
----------------------------------------------------- */
/**
 * Get county and state names from GEOID
 * Note: This requires a lookup table or API call for actual names
 */
function getCountyAndStateName(geoid) {
  const stateCode = geoid.substring(0, 2);
  const countyCode = geoid.substring(2, 5);
  
  // Texas state lookup (48 = Texas)
  const stateNames = {
    '48': 'Texas'
    // Add more states as needed
  };
  
  // Texas county lookup (partial - add more as needed)
  const texasCounties = {
    '113': 'Dallas County',
    '439': 'Tarrant County',
    '201': 'Harris County',
    '029': 'Bexar County',
    '085': 'Collin County',
    '121': 'Denton County'
    // Add more counties as needed
  };
  
  const stateName = stateNames[stateCode] || 'Unknown State';
  const countyName = stateCode === '48' ? (texasCounties[countyCode] || 'Unknown County') : 'Unknown County';
  
  return {
    stateName,
    countyName,
    stateCode,
    countyCode
  };
}

/* =========================================================
   5) Map Snapshot
   ========================================================= */

   // Instead of html2canvas for map snapshot, use Google Static Maps API:
async function generateMapSnapshot(center) {
    const zoom = map.getZoom();
    const size = '800x400';
    
    const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat()},${center.lng()}&zoom=${zoom}&size=${size}&markers=color:red|${center.lat()},${center.lng()}&key=${CONFIG.GOOGLE_MAPS_API_KEY}`;
    
    return imageUrl; // Direct image URL, no rendering needed
}


/* ----------------------------------------------------
   2) MAIN: Generate and display demographic report
----------------------------------------------------- */
async function generateDemographicReport() {
  try {
    if (!blockGroupData) {
      console.log("Block group data not loaded, loading now...");
      await loadBlockGroupData();
    }

    if (!demographicDataByGeoid) {
      console.log("Demographic CSV not loaded, loading now...");
      await loadDemographicCSV();
    }

 

    // Get address data (which should include lat/lng if your code does)
    const addressData = await getCurrentAddress();

    // Use lat/lng from getCurrentAddress if available, otherwise fall back to map center
    let lat, lng, address;

    if (addressData?.lat && addressData?.lng) {
      lat = addressData.lat;
      lng = addressData.lng;
      address = addressData.address;
    } else {
      const center = map.getCenter();
      lat = center.lat();
      lng = center.lng();
      address = addressData?.address || "Address Not Available";
    }

    console.log("Generating report for:", address, "at coordinates:", lat, lng);

    const radii = getRadiiFromSidebar();
    const maxRadius = Math.max(...radii);
  
    
    console.log("Using radii (miles):", radii);

    // Fetch data from CSV instead of Census API
    const demographicData = await fetchMultiRadiusDataFromCSV(lat, lng, radii);

// Urgent care only — no hospital/derm/autism fetches (saves API cost)
const urgentCareResults = await fetchNearbyPlaces(lat, lng, maxRadius, 'urgent_care');

const facilityCounts = {
  urgentCare: urgentCareResults.length,
  urgentCareDetails: urgentCareResults.slice(0, 10).map(function(p) {
    return {
      name:    p.name || 'Unknown',
      address: p.formatted_address || p.vicinity || 'N/A',
      lat:     p.geometry ? p.geometry.location.lat() : null,
      lng:     p.geometry ? p.geometry.location.lng() : null
    };
  }),
  centerLat: lat,
  centerLng: lng
};

console.log('Facility counts:', facilityCounts);

    // const facilityCounts = {
    //   urgentCare: typeof urgentCareMarkers !== "undefined" ? urgentCareMarkers.length : 0,
    //   hospitals: typeof hospitalMarkers !== "undefined" ? hospitalMarkers.length : 0,
    //   specialty: typeof dermMarkers !== "undefined" ? dermMarkers.length : 0,
    //   autism: typeof autismMarkers !== "undefined" ? autismMarkers.length : 0,
    // };

    const mapImageUrl = await generateMapSnapshot(new google.maps.LatLng(lat, lng));

    // Your existing report template population (dynamic radii supported)
    populateReportTemplate(address, demographicData, facilityCounts, mapImageUrl, radii);

    console.log("Report generated successfully");
  } catch (error) {
    console.error("Error generating report:", error);
    alert("Error generating report: " + error.message);
  }
}

function countMarkersInRadius(markers, centerLat, centerLng, radiusMiles) {
  if (!markers || markers.length === 0) return 0;
  
  let count = 0;
  for (const marker of markers) {
    const markerPos = marker.getPosition();
    const distance = getDistanceMiles(centerLat, centerLng, markerPos.lat(), markerPos.lng());
    if (distance <= radiusMiles) count++;
  }
  return count;
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}



/* =========================================================
   3) MULTI-RADIUS CORE (MAX RADIUS ONCE) - CSV VERSION
   - Finds BG membership for each radius, scanning features ONCE
   - Reads demographics from CSV for BGs in max radius ONCE
   - Aggregates subsets for smaller radii
   ========================================================= */

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeRadii(radii) {
  const clean = (radii || [])
    .map((r) => parseInt(r, 10))
    .filter((r) => Number.isFinite(r) && r > 0);
  const uniq = [...new Set(clean)];
  uniq.sort((a, b) => a - b);
  return uniq.length ? uniq : [1, 3, 5];
}

/**
 * Build circles once and classify BGs into each radius.
 * IMPORTANT: Only test features that intersect MAX radius first.
 *
 * Returns:
 * {
 *   byRadius: { "1mile": [GEOID...], ... },
 *   allGeoids: [unique GEOIDs within max radius]
 * }
 */
function getBlockGroupsByRadius(lat, lng, radii) {
  if (!blockGroupData) throw new Error("Block group data not loaded");
  if (typeof turf === "undefined") throw new Error("Turf.js not found. Load Turf via CDN before this script.");

  const sorted = normalizeRadii(radii);
  const maxR = sorted[sorted.length - 1];

  const center = turf.point([lng, lat]); // [lon, lat]
  const circles = {};
  for (const r of sorted) circles[r] = turf.circle(center, r, { units: "miles" });
  const maxCircle = circles[maxR];

  const byRadius = {};
  sorted.forEach((r) => (byRadius[`${r}mile`] = []));

  const allGeoidsSet = new Set();

  for (const feature of blockGroupData.features) {
    try {
      if (!feature?.geometry?.coordinates) continue;
      const geoid = feature?.properties?.GEOID;
      if (!geoid) continue;

      // repair geometry
      const cleanGeom = turf.buffer(feature.geometry, 0);

      // gate: must intersect max
      if (!turf.booleanIntersects(cleanGeom, maxCircle)) continue;

      allGeoidsSet.add(geoid);

      // classify into all radii buckets
      for (const r of sorted) {
        if (turf.booleanIntersects(cleanGeom, circles[r])) {
          byRadius[`${r}mile`].push(geoid);
        }
      }
    } catch (e) {
      // skip bad geometries
      continue;
    }
  }

  return {
    byRadius,
    allGeoids: [...allGeoidsSet],
  };
}

/**
 * Multi radius fetch using CSV data instead of Census API
 * Output shape:
 * {
 *   "1mile": {...},
 *   "5mile": {...},
 *   "8mile": {...}
 * }
 */
async function fetchMultiRadiusDataFromCSV(lat, lng, radii) {
  const sorted = normalizeRadii(radii);
  const maxR = sorted[sorted.length - 1];

  console.log("Radii (sorted):", sorted, "Max radius:", maxR);

  const { byRadius, allGeoids } = getBlockGroupsByRadius(lat, lng, sorted);

  console.log(`Found ${allGeoids.length} unique BGs within ${maxR} miles`);
  sorted.forEach((r) => console.log(`  ${r}mi BGs: ${byRadius[`${r}mile`].length}`));

  if (!allGeoids.length) {
    console.warn("No BGs found in max radius; using estimated data for all radii");
    const out = {};
    for (const r of sorted) out[`${r}mile`] = getEstimatedDataForRadius(r);
    return out;
  }

  // Get demographics from CSV for all found block groups
  const perGeoid = getCSVDataForGeoids(allGeoids);

   const geoIncome = calculateCountyAndStateIncome(allGeoids, perGeoid);
  
  // NEW: Get geographic names
  const firstGeoid = allGeoids[0];
  const geoNames = getCountyAndStateName(firstGeoid);

  // Aggregate per radius using subsets
  const out = {};
  for (const r of sorted) {
    const key = `${r}mile`;
    const geoids = byRadius[key] || [];
    if (!geoids.length) {
      out[key] = getEstimatedDataForRadius(r);
      continue;
    }

    const aggregated = aggregateFromPerGeoid(geoids, perGeoid);
    
       // NEW: Add county/state income to each radius data
    out[key] = { 
      ...aggregated, 
      //...projections,
      // countyMedianIncome: geoIncome.countyMedianIncome,
      stateMedianIncome: geoIncome.stateMedianIncome,
      countyName: geoNames.countyName,
      stateName: geoNames.stateName
    };
  }
  

  return out;
}

/**
 * Get CSV data for specified GEOIDs
 * Returns: Map<GEOID, processedData>
 */
function getCSVDataForGeoids(geoids) {
  if (!demographicDataByGeoid) {
    throw new Error("Demographic CSV data not loaded");
  }

  const perGeoid = new Map();
  let foundCount = 0;

  for (const geoid of geoids) {
    const csvRecord = demographicDataByGeoid.get(geoid);
    
    if (csvRecord) {
      const processed = processCSVRecord(csvRecord);
      perGeoid.set(geoid, processed);
      foundCount++;
    } else {
      console.warn(`GEOID ${geoid} not found in CSV data`);
    }
  }

  console.log(`CSV data retrieved: ${foundCount}/${geoids.length} block groups found`);
  return perGeoid;
}

/**
 * Process CSV record into report-shaped object
 * Reads directly from CSV columns
 */
function processCSVRecord(record) {
  // Age data is pre-calculated in CSV - Current
  const age_0_17 = record.age_0_17_curr || 0;
  const age_18_34 = record.age_18_34_curr || 0;
  const age_35_54 = record.age_35_54_curr || 0;
  const age_55_64 = record.age_55_64_curr || 0;
  const age_65plus = record.age_65plus_curr || 0;

  // Age data - Prior (for calculating historical growth)
  const age_0_17_prior = record.age_0_17_prior || 0;
  const age_18_34_prior = record.age_18_34_prior || 0;
  const age_35_54_prior = record.age_35_54_prior || 0;
  const age_55_64_prior = record.age_55_64_prior || 0;
  const age_65plus_prior = record.age_65plus_prior || 0;

  // Income brackets - combine Census variables according to brackets
  const income = {
    "Under $25,000":
      (record.B19001_002E_curr || 0) + (record.B19001_003E_curr || 0) + 
      (record.B19001_004E_curr || 0) + (record.B19001_005E_curr || 0),
    "$25,000 - $49,999":
      (record.B19001_006E_curr || 0) + (record.B19001_007E_curr || 0) + 
      (record.B19001_008E_curr || 0) + (record.B19001_009E_curr || 0),
    "$50,000 - $74,999":
      (record.B19001_010E_curr || 0) + (record.B19001_011E_curr || 0) + (record.B19001_012E_curr || 0),
    "$75,000 - $99,999": (record.B19001_013E_curr || 0),
    "$100,000 - $149,999":
      (record.B19001_014E_curr || 0) + (record.B19001_015E_curr || 0),
    "$150,000+": (record.B19001_016E_curr || 0) + (record.B19001_017E_curr || 0),
  };

  return {
    population: record.B01003_001E_curr || 0,
    households: record.B11001_001E_curr || 0,
    families: record.B11001_002E_curr || 0,
    medianIncome: record.B19013_001E_curr || 0,
    perCapitaIncome: record.B19301_001E_curr || 0,

    age_0_17,
    age_18_34,
    age_35_54,
    age_55_64,
    age_65plus,

    // Add prior age data for growth calculations
    age_0_17_prior,
    age_18_34_prior,
    age_35_54_prior,
    age_55_64_prior,
    age_65plus_prior,

    income,

    housing: {
      totalUnits: record.B25001_001E_curr || 0,
      medianValue: record.B25077_001E_curr || 0,
      medianRent: record.B25064_001E_curr || 0,
    },
    
    // Additional fields that might be added
    homeownershipRate: record.homeownership_rate || 0,

 // Population projections and growth
    change_pop: record.change_pop || 0,
    CAGR_pop: record.CAGR_pop || 0,
    pop_proj: record.pop_proj || 0,
    
    // Household projections and growth
    change_hh: record.change_hh || 0,
    CAGR_hh: record.CAGR_hh || 0,
    hh_proj: record.hh_proj || 0,
    
    // Family projections and growth
    change_fam: record.change_fam || 0,
    CAGR_fam: record.CAGR_fam || 0,
    fam_proj: record.fam_proj || 0,
    
    // Income projections and growth
    change_med_inc: record.change_med_inc || 0,
    CAGR_med_inc: record.CAGR_med_inc || 0,
    med_inc_proj: record.med_inc_proj || 0,
    
    // Per capita projections and growth
    change_per_capita: record.change_per_capita || 0,
    CAGR_per_capita: record.CAGR_per_capita || 0,
    per_capita_proj: record.per_capita_proj || 0,
  };
}
/**
 * Aggregate any subset of GEOIDs from perGeoid Map (already processed)
 * Returns the same aggregated shape your report expects.
 */
function aggregateFromPerGeoid(geoids, perGeoid) {
  const aggregated = {
    population: 0,
    households: 0,
    families: 0,
    medianIncome: 0,
    perCapitaIncome: 0,

    age_0_17: 0,
    age_18_34: 0,
    age_35_54: 0,
    age_55_64: 0,
    age_65plus: 0,

    // Prior age data for calculating historical growth
    age_0_17_prior: 0,
    age_18_34_prior: 0,
    age_35_54_prior: 0,
    age_55_64_prior: 0,
    age_65plus_prior: 0,

    income: {
      "Under $25,000": 0,
      "$25,000 - $49,999": 0,
      "$50,000 - $74,999": 0,
      "$75,000 - $99,999": 0,
      "$100,000 - $149,999": 0,
      "$150,000+": 0,
    },

    employment: {
      "Labor Force Participation Rate": { local: 0, usa: 63.4 },
      "Unemployment Rate": { local: 0, usa: 3.7 },
      "Bachelor's Degree or Higher": { local: 0, usa: 32.6 },
      "High School Graduate or Higher": { local: 0, usa: 88.5 },
      "Professional/Management Occupations": { local: 0, usa: 37.5 },
    },

    // Population-weighted rate accumulators for ACS pct CSV
    // Each stores { rateSum, popSum } for weighted average calculation
    _emp: {
      laborForce:   { rateSum: 0, popSum: 0 },
      unemployment: { rateSum: 0, popSum: 0 },
      bachelors:    { rateSum: 0, popSum: 0 },
      hs:           { rateSum: 0, popSum: 0 },
      mgmt:         { rateSum: 0, popSum: 0 },
      // National values read from first matched CSV row
      natlLaborForce:   0,
      natlUnemployment: 0,
      natlBachelors:    0,
      natlHS:           0,
      natlMgmt:         0,
      natlCaptured:     false,
    },

    housing: {
      totalUnits: 0,
      medianValue: 0,
      medianRent: 0,
    },

     change_pop: 0,
    CAGR_pop: 0,
    pop_proj: 0,
    
    change_hh: 0,
    CAGR_hh: 0,
    hh_proj: 0,
    
    change_fam: 0,
    CAGR_fam: 0,
    fam_proj: 0,
    
    change_med_inc: 0,
    CAGR_med_inc: 0,
    med_inc_proj: 0,
    
    change_per_capita: 0,
    CAGR_per_capita: 0,
    per_capita_proj: 0,
  };

  let incomeCount = 0;
  let housingValueCount = 0;
  let housingRentCount = 0;

   // Counters for averaging CAGR and per capita
  let cagrPopCount = 0;
  let cagrHhCount = 0;
  let cagrFamCount = 0;
  let cagrMedIncCount = 0;
  let cagrPerCapitaCount = 0;
  let perCapitaCount = 0;
  let medIncProjSum = 0;
  let medIncProjCount = 0;
  let perCapProjSum = 0;
  let perCapProjCount = 0;

  for (const geoid of geoids) {
    const d = perGeoid.get(geoid);
    if (!d) continue;

    aggregated.population += d.population || 0;
    aggregated.households += d.households || 0;
    aggregated.families += d.families || 0;

    aggregated.age_0_17 += d.age_0_17 || 0;
    aggregated.age_18_34 += d.age_18_34 || 0;
    aggregated.age_35_54 += d.age_35_54 || 0;
    aggregated.age_55_64 += d.age_55_64 || 0;
    aggregated.age_65plus += d.age_65plus || 0;

    // Aggregate prior age data
    aggregated.age_0_17_prior += d.age_0_17_prior || 0;
    aggregated.age_18_34_prior += d.age_18_34_prior || 0;
    aggregated.age_35_54_prior += d.age_35_54_prior || 0;
    aggregated.age_55_64_prior += d.age_55_64_prior || 0;
    aggregated.age_65plus_prior += d.age_65plus_prior || 0;

    if (d.income) {
      for (const k of Object.keys(aggregated.income)) {
        aggregated.income[k] += d.income[k] || 0;
      }
    }

    if (d.med_inc_proj && d.med_inc_proj > 0) {
    medIncProjSum += d.med_inc_proj;
    medIncProjCount++;
  }


    if (d.medianIncome && d.medianIncome > 0) {
      aggregated.medianIncome += d.medianIncome;
      incomeCount++;
    }

     if (d.perCapitaIncome && d.perCapitaIncome > 0) {
      aggregated.perCapitaIncome += d.perCapitaIncome;
      perCapitaCount++;
    }


    if (d.housing) {
      aggregated.housing.totalUnits += d.housing.totalUnits || 0;

      if (d.housing.medianValue && d.housing.medianValue > 0) {
        aggregated.housing.medianValue += d.housing.medianValue;
        housingValueCount++;
      }
      if (d.housing.medianRent && d.housing.medianRent > 0) {
        aggregated.housing.medianRent += d.housing.medianRent;
        housingRentCount++;
      }
    }
    
    // PROJECTION AGGREGATIONS (still inside loop)
    aggregated.change_pop += d.change_pop || 0;
    if (d.CAGR_pop && d.CAGR_pop !== 0) {
      aggregated.CAGR_pop += d.CAGR_pop;
      cagrPopCount++;
    }
    
    aggregated.change_hh += d.change_hh || 0;
    if (d.CAGR_hh && d.CAGR_hh !== 0) {
      aggregated.CAGR_hh += d.CAGR_hh;
      cagrHhCount++;
    }
    
    aggregated.change_fam += d.change_fam || 0;
    if (d.CAGR_fam && d.CAGR_fam !== 0) {
      aggregated.CAGR_fam += d.CAGR_fam;
      cagrFamCount++;
    }
    
    aggregated.change_med_inc += d.change_med_inc || 0;
    if (d.CAGR_med_inc && d.CAGR_med_inc !== 0) {
      aggregated.CAGR_med_inc += d.CAGR_med_inc;
      cagrMedIncCount++;
    }
    

// In loop:
if (d.per_capita_proj && d.per_capita_proj > 0) {
  perCapProjSum += d.per_capita_proj;
  perCapProjCount++;
}

    // ===== ACCUMULATE ACS EMPLOYMENT/EDUCATION RATES (population-weighted) =====
    if (acsPctDataByGeoid && acsPctDataByGeoid.size > 0) {
      const pctRec = acsPctDataByGeoid.get(geoid);
      if (pctRec) {
        // Use block group population as weight; fall back to 1 if population is 0
        const weight = d.population > 0 ? d.population : 1;

        if (pctRec.laborForceRate  > 0) { aggregated._emp.laborForce.rateSum   += pctRec.laborForceRate  * weight; aggregated._emp.laborForce.popSum   += weight; }
        if (pctRec.unemploymentRate > 0) { aggregated._emp.unemployment.rateSum += pctRec.unemploymentRate * weight; aggregated._emp.unemployment.popSum += weight; }
        if (pctRec.bachelorsRate    > 0) { aggregated._emp.bachelors.rateSum    += pctRec.bachelorsRate    * weight; aggregated._emp.bachelors.popSum    += weight; }
        if (pctRec.hsRate           > 0) { aggregated._emp.hs.rateSum           += pctRec.hsRate           * weight; aggregated._emp.hs.popSum           += weight; }
        if (pctRec.mgmtRate         > 0) { aggregated._emp.mgmt.rateSum         += pctRec.mgmtRate         * weight; aggregated._emp.mgmt.popSum         += weight; }

        // National values are the same on every row — capture once from the first valid record
        if (!aggregated._emp.natlCaptured && pctRec.natlLaborForce > 0) {
          aggregated._emp.natlLaborForce   = pctRec.natlLaborForce;
          aggregated._emp.natlUnemployment = pctRec.natlUnemployment;
          aggregated._emp.natlBachelors    = pctRec.natlBachelors;
          aggregated._emp.natlHS           = pctRec.natlHS;
          aggregated._emp.natlMgmt         = pctRec.natlMgmt;
          aggregated._emp.natlCaptured     = true;
        }
      }
    }
    // ===== END ACS EMPLOYMENT ACCUMULATION =====

  }  // ← CLOSE THE FOR LOOP HERE

  // ===== CALCULATE EMPLOYMENT/EDUCATION PERCENTAGES FROM ACS PCT CSV =====
  // Population-weighted average across all block groups in the radius
  const emp = aggregated._emp;

  // Use national values from CSV if captured; fall back to hardcoded ACS benchmarks
  const USA = {
    laborForce:   emp.natlCaptured && emp.natlLaborForce   > 0 ? parseFloat(emp.natlLaborForce.toFixed(1))   : 63.4,
    unemployment: emp.natlCaptured && emp.natlUnemployment > 0 ? parseFloat(emp.natlUnemployment.toFixed(1)) : 3.7,
    bachelors:    emp.natlCaptured && emp.natlBachelors    > 0 ? parseFloat(emp.natlBachelors.toFixed(1))    : 33.7,
    hs:           emp.natlCaptured && emp.natlHS           > 0 ? parseFloat(emp.natlHS.toFixed(1))           : 88.5,
    mgmt:         emp.natlCaptured && emp.natlMgmt         > 0 ? parseFloat(emp.natlMgmt.toFixed(1))         : 38.2,
  };

  console.log("National benchmarks from CSV:", emp.natlCaptured ? "✓ loaded" : "⚠ using hardcoded fallbacks", USA);

  const weightedAvg = (bucket, fallback) =>
    bucket.popSum > 0
      ? parseFloat((bucket.rateSum / bucket.popSum).toFixed(1))
      : fallback;

  aggregated.employment["Labor Force Participation Rate"] = {
    local: weightedAvg(emp.laborForce,   USA.laborForce),
    usa:   USA.laborForce
  };

  aggregated.employment["Unemployment Rate"] = {
    local: weightedAvg(emp.unemployment, USA.unemployment),
    usa:   USA.unemployment
  };

  aggregated.employment["Bachelor's Degree or Higher"] = {
    local: weightedAvg(emp.bachelors,    USA.bachelors),
    usa:   USA.bachelors
  };

  aggregated.employment["High School Graduate or Higher"] = {
    local: weightedAvg(emp.hs,           USA.hs),
    usa:   USA.hs
  };

  aggregated.employment["Professional/Management Occupations"] = {
    local: weightedAvg(emp.mgmt,         USA.mgmt),
    usa:   USA.mgmt
  };

  console.log("Employment metrics (pop-weighted):", {
    "Labor Force":  aggregated.employment["Labor Force Participation Rate"].local + "% (natl: " + USA.laborForce + "%)",
    "Unemployment": aggregated.employment["Unemployment Rate"].local + "% (natl: " + USA.unemployment + "%)",
    "Bachelors+":   aggregated.employment["Bachelor's Degree or Higher"].local + "% (natl: " + USA.bachelors + "%)",
    "HS+":          aggregated.employment["High School Graduate or Higher"].local + "% (natl: " + USA.hs + "%)",
    "Mgmt/Prof":    aggregated.employment["Professional/Management Occupations"].local + "% (natl: " + USA.mgmt + "%)"
  });
  
  // CALCULATIONS AFTER LOOP (outside the loop)
  // Population projection
  aggregated.pop_proj = Math.round(aggregated.population + aggregated.change_pop);
  
  // Household projection
  aggregated.hh_proj = Math.round(aggregated.households + aggregated.change_hh);
  
  // Family projection
  aggregated.fam_proj = Math.round(aggregated.families + aggregated.change_fam);
  
  // Median income projection
  aggregated.med_inc_proj = medIncProjCount > 0 
    ? Math.round(medIncProjSum / medIncProjCount) 
    : 0;

  // Calculate % change from current to projected
  const currentMedInc = aggregated.medianIncome || 0;
  const projectedMedInc = aggregated.med_inc_proj || 0;
  aggregated.med_inc_change_pct = currentMedInc > 0 
    ? ((projectedMedInc - currentMedInc) / currentMedInc * 100) 
    : 0;

  aggregated.per_capita_proj = perCapProjCount > 0 ? Math.round(perCapProjSum / perCapProjCount) : 0;

  // Average the median values
  aggregated.medianIncome = incomeCount > 0 ? Math.round(aggregated.medianIncome / incomeCount) : 65000;
  aggregated.perCapitaIncome = perCapitaCount > 0 ? Math.round(aggregated.perCapitaIncome / perCapitaCount) : 38000;
  aggregated.housing.medianValue = housingValueCount > 0 ? Math.round(aggregated.housing.medianValue / housingValueCount) : 285000;
  aggregated.housing.medianRent = housingRentCount > 0 ? Math.round(aggregated.housing.medianRent / housingRentCount) : 1450;
  
  // Average CAGR rates (these should be averaged, not summed)
  aggregated.CAGR_pop = cagrPopCount > 0 ? aggregated.CAGR_pop / cagrPopCount : 0;
  aggregated.CAGR_hh = cagrHhCount > 0 ? aggregated.CAGR_hh / cagrHhCount : 0;
  aggregated.CAGR_fam = cagrFamCount > 0 ? aggregated.CAGR_fam / cagrFamCount : 0;
  aggregated.CAGR_med_inc = cagrMedIncCount > 0 ? aggregated.CAGR_med_inc / cagrMedIncCount : 0;
  aggregated.CAGR_per_capita = cagrPerCapitaCount > 0 ? aggregated.CAGR_per_capita / cagrPerCapitaCount : 0;

 

  return aggregated;


}

/* =========================================================
   4) Projections
   ========================================================= */
// function calculateProjections(currentPop) {
//   const growthRate = 0.016; // 1.6% annual growth
//   return {
//     pop2026: Math.round(currentPop * 1.0),
//     pop2031: Math.round(currentPop * (1 + growthRate * 5)),
//   };
// }


function populateAllDemographics(doc, data, radii) {
  if (!radii || radii.length === 0) {
    console.error("No radii provided");
    return;
  }

  const sortedRadii = normalizeRadii(radii);
  const maxRadius = sortedRadii[sortedRadii.length - 1];

  // Populate county and state median income (use largest radius data)
  const maxRadiusData = data[`${sortedRadii[sortedRadii.length - 1]}mile`];
  
  if (maxRadiusData) {
    // County income
    setIfExists(doc, "county-median-income", formatCurrency(maxRadiusData.countyMedianIncome || 0));
    setIfExists(doc, "county-name", maxRadiusData.countyName || "County");
    
    // State income
    setIfExists(doc, "state-median-income", formatCurrency(maxRadiusData.stateMedianIncome || 0));
    setIfExists(doc, "state-name", maxRadiusData.stateName || "State");
    
    // Optional: Calculate comparison percentages
    if (maxRadiusData.medianIncome > 0) {
      const vsCounty = ((maxRadiusData.medianIncome / maxRadiusData.countyMedianIncome - 1) * 100).toFixed(1);
      const vsState = ((maxRadiusData.medianIncome / maxRadiusData.stateMedianIncome - 1) * 100).toFixed(1);
      
      setIfExists(doc, "income-vs-county", (vsCounty >= 0 ? "+" : "") + vsCounty + "%");
      setIfExists(doc, "income-vs-state", (vsState >= 0 ? "+" : "") + vsState + "%");
    }
  }

  // Update all dynamic radius text elements in the template
  // These IDs should be added to your HTML template where "X-Mile Radius" text appears
  setIfExists(doc, "radius1-value", `${sortedRadii[0] || 1}`);
  setIfExists(doc, "radius2-value", `${sortedRadii[1] || 3}`);
  setIfExists(doc, "radius3-value", `${sortedRadii[2] || 5}`);
  
  // Update chart labels (if they have separate IDs)
  setIfExists(doc, "radius1-value-chart", `${sortedRadii[0] || 1}`);
  setIfExists(doc, "radius2-value-chart", `${sortedRadii[1] || 3}`);
  setIfExists(doc, "radius3-value-chart", `${sortedRadii[2] || 5}`);
  
  // Update chart title with max radius
  setIfExists(doc, "chart-title-radius", `${maxRadius}`);
  
  // Update any text that references the max radius
  setIfExists(doc, "max-radius-value", `${maxRadius}`);
  setIfExists(doc, "max-radius-value-2", `${maxRadius}`);

  // Map radii to template positions: smallest -> 1mi, middle -> 3mi, largest -> 5mi
  sortedRadii.forEach((radius, index) => {
    const radiusKey = `${radius}mile`;
    if (!data[radiusKey]) {
      console.warn(`No data found for ${radiusKey}`);
      return;
    }

    const d = data[radiusKey];
    const suffix = index === 0 ? "1mi" : index === 1 ? "3mi" : "5mi";

    // Largest radius executive summary
    if (index === 2) {
      setIfExists(doc, "exec-pop-5mi", formatNumber(d.population));
      setIfExists(doc, "exec-hh-5mi", formatNumber(d.households));
    }

    // Update table header labels with actual radius values
    setIfExists(doc, `radius-label-${suffix}`, `${radius} mi`);

    // Basic demographics
    setIfExists(doc, `demo-pop-${suffix}`, formatNumber(d.population));
    setIfExists(doc, `demo-hh-${suffix}`, formatNumber(d.households));
    setIfExists(doc, `demo-fam-${suffix}`, formatNumber(d.families));

    if (d.households > 0) {
      setIfExists(doc, `demo-hhsize-${suffix}`, (d.population / d.households).toFixed(1));
    }

    // Age
    setIfExists(doc, `age-0-17-${suffix}`, formatNumber(d.age_0_17));
    setIfExists(doc, `age-18-34-${suffix}`, formatNumber(d.age_18_34));
    setIfExists(doc, `age-35-54-${suffix}`, formatNumber(d.age_35_54));
    setIfExists(doc, `age-55-64-${suffix}`, formatNumber(d.age_55_64));
    setIfExists(doc, `age-65plus-${suffix}`, formatNumber(d.age_65plus));

    if (d.population > 0) {
      setIfExists(doc, `age-0-17-pct-${suffix}`, ((d.age_0_17 / d.population) * 100).toFixed(1) + "%");
      setIfExists(doc, `age-18-34-pct-${suffix}`, ((d.age_18_34 / d.population) * 100).toFixed(1) + "%");
      setIfExists(doc, `age-35-54-pct-${suffix}`, ((d.age_35_54 / d.population) * 100).toFixed(1) + "%");
      setIfExists(doc, `age-55-64-pct-${suffix}`, ((d.age_55_64 / d.population) * 100).toFixed(1) + "%");
      setIfExists(doc, `age-65plus-pct-${suffix}`, ((d.age_65plus / d.population) * 100).toFixed(1) + "%");
    }

    // Charts + income/housing (largest radius only)
    if (index === 2) {
      setIfExists(doc, "chart-age-0-17", formatNumber(d.age_0_17));
      setIfExists(doc, "chart-age-18-34", formatNumber(d.age_18_34));
      setIfExists(doc, "chart-age-35-54", formatNumber(d.age_35_54));
      setIfExists(doc, "chart-age-55-64", formatNumber(d.age_55_64));
      setIfExists(doc, "chart-age-65plus", formatNumber(d.age_65plus));

      const maxPop = Math.max(d.age_0_17, d.age_18_34, d.age_35_54, d.age_55_64, d.age_65plus);
      if (maxPop > 0) {
        const bar0_17 = doc.getElementById("bar-age-0-17");
        const bar18_34 = doc.getElementById("bar-age-18-34");
        const bar35_54 = doc.getElementById("bar-age-35-54");
        const bar55_64 = doc.getElementById("bar-age-55-64");
        const bar65plus = doc.getElementById("bar-age-65plus");

        if (bar0_17) bar0_17.style.height = (d.age_0_17 / maxPop) * 200 + "px";
        if (bar18_34) bar18_34.style.height = (d.age_18_34 / maxPop) * 200 + "px";
        if (bar35_54) bar35_54.style.height = (d.age_35_54 / maxPop) * 200 + "px";
        if (bar55_64) bar55_64.style.height = (d.age_55_64 / maxPop) * 200 + "px";
        if (bar65plus) bar65plus.style.height = (d.age_65plus / maxPop) * 200 + "px";
      }

      if (d.income) {
        const totalHH = d.households || 1;

        setIfExists(doc, "income-under25k", formatNumber(d.income["Under $25,000"]));
        setIfExists(doc, "income-under25k-pct", ((d.income["Under $25,000"] / totalHH) * 100).toFixed(1) + "%");

        setIfExists(doc, "income-25k-50k", formatNumber(d.income["$25,000 - $49,999"]));
        setIfExists(doc, "income-25k-50k-pct", ((d.income["$25,000 - $49,999"] / totalHH) * 100).toFixed(1) + "%");

        setIfExists(doc, "income-50k-75k", formatNumber(d.income["$50,000 - $74,999"]));
        setIfExists(doc, "income-50k-75k-pct", ((d.income["$50,000 - $74,999"] / totalHH) * 100).toFixed(1) + "%");

        setIfExists(doc, "income-75k-100k", formatNumber(d.income["$75,000 - $99,999"]));
        setIfExists(doc, "income-75k-100k-pct", ((d.income["$75,000 - $99,999"] / totalHH) * 100).toFixed(1) + "%");

        setIfExists(doc, "income-100k-150k", formatNumber(d.income["$100,000 - $149,999"]));
        setIfExists(doc, "income-100k-150k-pct", ((d.income["$100,000 - $149,999"] / totalHH) * 100).toFixed(1) + "%");

        setIfExists(doc, "income-150k-plus", formatNumber(d.income["$150,000+"]));
        setIfExists(doc, "income-150k-plus-pct", ((d.income["$150,000+"] / totalHH) * 100).toFixed(1) + "%");
      }

      // ADD THIS NEW SECTION HERE:
  // ===== MEDIAN INCOME COMPARISON CHART =====
  setIfExists(doc, "radius1-value-income", `${sortedRadii[0] || 1}`);
  setIfExists(doc, "radius2-value-income", `${sortedRadii[1] || 3}`);
  setIfExists(doc, "radius3-value-income", `${sortedRadii[2] || 5}`);
  
  const incomes = sortedRadii.map((radius, index) => {
    const radiusKey = `${radius}mile`;
    return data[radiusKey]?.medianIncome || 0;
  });
  
  const maxIncome = Math.max(...incomes);
  
  sortedRadii.forEach((radius, index) => {
    const radiusKey = `${radius}mile`;
    const d = data[radiusKey];
    const suffix = index === 0 ? "1mi" : index === 1 ? "3mi" : "5mi";
    
    if (d && d.medianIncome) {
      const incomeFormatted = "$" + (d.medianIncome / 1000).toFixed(1) + "K";
      setIfExists(doc, `median-income-${suffix}`, incomeFormatted);
      
      const barHeight = maxIncome > 0 ? (d.medianIncome / maxIncome) * 100 : 0;
      const barElement = doc.getElementById(`bar-median-income-${suffix}`);
      if (barElement) {
        barElement.style.height = barHeight + "%";
      }
    }
  });

      if (d.housing) {
        const medianValue = d.housing.medianValue || 0;
        const valueFormatted =
          medianValue >= 1000000 ? "$" + (medianValue / 1000000).toFixed(1) + "M" : "$" + (medianValue / 1000).toFixed(0) + "K";

        setIfExists(doc, "housing-median-value", valueFormatted);
        setIfExists(doc, "housing-median-rent", "$" + formatNumber(d.housing.medianRent || 0));
        setIfExists(doc, "housing-total-units", formatNumber(d.housing.totalUnits || 0));
      }

      // ===== EMPLOYMENT & EDUCATION (max radius only) =====
      if (d.employment) {
        const emp = d.employment;

        // Labor Force Participation Rate
        const lfpr = emp["Labor Force Participation Rate"];
        if (lfpr) {
          setIfExists(doc, "emp-labor-force-local",  lfpr.local.toFixed(1) + "%");
          setIfExists(doc, "emp-labor-force-usa",    lfpr.usa.toFixed(1) + "% (National)");
        }

        // Unemployment Rate
        const unemp = emp["Unemployment Rate"];
        if (unemp) {
          setIfExists(doc, "emp-unemployment-local", unemp.local.toFixed(1) + "%");
          setIfExists(doc, "emp-unemployment-usa",   unemp.usa.toFixed(1) + "% (National)");
        }

        // Bachelor's Degree or Higher
        const bach = emp["Bachelor's Degree or Higher"];
        if (bach) {
          setIfExists(doc, "emp-bachelors-local", bach.local.toFixed(1) + "%");
          setIfExists(doc, "emp-bachelors-usa",   bach.usa.toFixed(1) + "% (National)");
        }

        // High School Graduate or Higher
        const hs = emp["High School Graduate or Higher"];
        if (hs) {
          setIfExists(doc, "emp-hs-local", hs.local.toFixed(1) + "%");
          setIfExists(doc, "emp-hs-usa",   hs.usa.toFixed(1) + "% (National)");
        }

        // Professional / Management Occupations
        const mgmt = emp["Professional/Management Occupations"];
        if (mgmt) {
          setIfExists(doc, "emp-mgmt-local", mgmt.local.toFixed(1) + "%");
          setIfExists(doc, "emp-mgmt-usa",   mgmt.usa.toFixed(1) + "% (National)");
        }
      }
      // ===== END EMPLOYMENT & EDUCATION =====
    }


    //median income
    
    // Median income comparison (all radii)
    if (d.medianIncome) {
      const incomeFormatted = "$" + (d.medianIncome / 1000).toFixed(1) + "K";
      setIfExists(doc, `median-income-${suffix}`, incomeFormatted);
    }

    // Projections (all radii)
    setIfExists(doc, `proj-pop-${suffix}-current`, formatNumber(d.pop2026 || d.population));
    setIfExists(doc, `proj-pop-${suffix}-future`, formatNumber(d.pop2031 || Math.round(d.population * 1.08)));

    const currentPop = d.pop2026 || d.population;
    const futurePop = d.pop2031 || Math.round(d.population * 1.08);
    const growthRate = currentPop > 0 ? (((futurePop - currentPop) / currentPop) * 100).toFixed(1) : "0.0";
    setIfExists(doc, `proj-growth-${suffix}`, growthRate + "%");
 
   // 1) Population change
    setIfExists(doc, `pop-change-${suffix}`, formatNumber(d.change_pop || 0));
    
    // 2) Population CAGR as percentage
    const cagrPop = d.CAGR_pop || 0;
    setIfExists(doc, `pop-cagr-${suffix}`, (cagrPop * 100).toFixed(2) + "%");
    
    // Population projection
    setIfExists(doc, `pop-proj-${suffix}`, formatNumber(d.pop_proj || 0));

      // ===== NEW: MAX RADIUS (RADIUS 3) PROJECTIONS =====
    if (index === 2) {  // Largest radius only

     // 3) HOUSEHOLDS PROJECTION with % change
      const hhCurrent = d.households || 0;
      const hhProj = d.hh_proj || 0;
      const hhChange = hhCurrent > 0 ? ((hhProj - hhCurrent) / hhCurrent * 100) : 0;
      
      setIfExists(doc, "hh-proj-current", formatNumber(hhCurrent));
      setIfExists(doc, "hh-proj-future", formatNumber(Math.round(hhProj)));
      setIfExists(doc, "hh-proj-change", (hhChange >= 0 ? "+" : "") + hhChange.toFixed(1) + "%");
      setIfExists(doc, "hh-cagr", (d.CAGR_hh * 100).toFixed(2) + "%");
      
      // 4) FAMILIES PROJECTION with % change
      const famCurrent = d.families || 0;
      const famProj = d.fam_proj || 0;
      const famChange = famCurrent > 0 ? ((famProj - famCurrent) / famCurrent * 100) : 0;
      
      setIfExists(doc, "fam-proj-current", formatNumber(famCurrent));
      setIfExists(doc, "fam-proj-future", formatNumber(Math.round(famProj)));
      setIfExists(doc, "fam-proj-change", (famChange >= 0 ? "+" : "") + famChange.toFixed(1) + "%");
      setIfExists(doc, "fam-cagr", (d.CAGR_fam * 100).toFixed(2) + "%");
      
      // 5) MEDIAN INCOME PROJECTION with % change
      const medIncCurrent = d.medianIncome || 0;
      const medIncProj = d.med_inc_proj || 0;
      const medIncChange = medIncCurrent > 0 ? ((medIncProj - medIncCurrent) / medIncCurrent * 100) : 0;
      
      setIfExists(doc, "med-inc-proj-current", "$" + (medIncCurrent / 1000).toFixed(1) + "K");
      setIfExists(doc, "med-inc-proj-future", "$" + (medIncProj / 1000).toFixed(1) + "K");
      setIfExists(doc, "med-inc-proj-change", (medIncChange >= 0 ? "+" : "") + medIncChange.toFixed(1) + "%");
      setIfExists(doc, "med-inc-cagr", (d.CAGR_med_inc * 100).toFixed(2) + "%");
      
      // 6) PER CAPITA PROJECTION with % change
      const perCapCurrent = d.perCapitaIncome || 0;
      const perCapProj = d.per_capita_proj || 0;
      const perCapChange = perCapCurrent > 0 ? ((perCapProj - perCapCurrent) / perCapCurrent * 100) : 0;
      
      setIfExists(doc, "per-capita-current", "$" + formatNumber(Math.round(perCapCurrent)));
      setIfExists(doc, "per-capita-future", "$" + formatNumber(Math.round(perCapProj)));
      setIfExists(doc, "per-capita-change", (perCapChange >= 0 ? "+" : "") + perCapChange.toFixed(1) + "%");
      setIfExists(doc, "per-capita-cagr", (d.CAGR_per_capita * 100).toFixed(2) + "%");


      // ===== AGE GROUP SHIFTS SECTION (Max radius only) =====
      if (index === 2) {
        // Calculate age-specific growth rates from historical data (_prior to _curr)
        // This gives us actual observed growth for each age cohort
        const years = 5; // Period from prior to current (typically 5 years for ACS data)
        const projectionYears = 5; // 2026 to 2031
        
        // Calculate CAGR for each age group based on historical growth
        const calculateAgeCAGR = (current, prior, years) => {
          if (prior <= 0 || current <= 0) return 0;
          return Math.pow(current / prior, 1 / years) - 1;
        };
        
        const cagr_0_17 = calculateAgeCAGR(d.age_0_17, d.age_0_17_prior, years);
        const cagr_18_34 = calculateAgeCAGR(d.age_18_34, d.age_18_34_prior, years);
        const cagr_35_54 = calculateAgeCAGR(d.age_35_54, d.age_35_54_prior, years);
        const cagr_55_64 = calculateAgeCAGR(d.age_55_64, d.age_55_64_prior, years);
        const cagr_65plus = calculateAgeCAGR(d.age_65plus, d.age_65plus_prior, years);
        
        console.log('Age-specific CAGRs:', {
          '0-17': (cagr_0_17 * 100).toFixed(2) + '%',
          '18-34': (cagr_18_34 * 100).toFixed(2) + '%',
          '35-54': (cagr_35_54 * 100).toFixed(2) + '%',
          '55-64': (cagr_55_64 * 100).toFixed(2) + '%',
          '65+': (cagr_65plus * 100).toFixed(2) + '%'
        });
        
        // Project each age group forward using its historical CAGR
        const age_0_17_proj = Math.round(d.age_0_17 * Math.pow(1 + cagr_0_17, projectionYears));
        const age_18_34_proj = Math.round(d.age_18_34 * Math.pow(1 + cagr_18_34, projectionYears));
        const age_35_54_proj = Math.round(d.age_35_54 * Math.pow(1 + cagr_35_54, projectionYears));
        const age_55_64_proj = Math.round(d.age_55_64 * Math.pow(1 + cagr_55_64, projectionYears));
        const age_65plus_proj = Math.round(d.age_65plus * Math.pow(1 + cagr_65plus, projectionYears));
        
        // Calculate totals
        const totalPopCurr = d.age_0_17 + d.age_18_34 + d.age_35_54 + d.age_55_64 + d.age_65plus;
        const totalPopProj = age_0_17_proj + age_18_34_proj + age_35_54_proj + age_55_64_proj + age_65plus_proj;
        
        console.log('Age projections:', {
          current: totalPopCurr,
          projected: totalPopProj,
          growth: ((totalPopProj / totalPopCurr - 1) * 100).toFixed(1) + '%'
        });
        
        // Calculate percentages
        const pct_0_17_curr = totalPopCurr > 0 ? (d.age_0_17 / totalPopCurr) * 100 : 0;
        const pct_18_34_curr = totalPopCurr > 0 ? (d.age_18_34 / totalPopCurr) * 100 : 0;
        const pct_35_54_curr = totalPopCurr > 0 ? (d.age_35_54 / totalPopCurr) * 100 : 0;
        const pct_55_64_curr = totalPopCurr > 0 ? (d.age_55_64 / totalPopCurr) * 100 : 0;
        const pct_65plus_curr = totalPopCurr > 0 ? (d.age_65plus / totalPopCurr) * 100 : 0;
        
        const pct_0_17_proj = totalPopProj > 0 ? (age_0_17_proj / totalPopProj) * 100 : 0;
        const pct_18_34_proj = totalPopProj > 0 ? (age_18_34_proj / totalPopProj) * 100 : 0;
        const pct_35_54_proj = totalPopProj > 0 ? (age_35_54_proj / totalPopProj) * 100 : 0;
        const pct_55_64_proj = totalPopProj > 0 ? (age_55_64_proj / totalPopProj) * 100 : 0;
        const pct_65plus_proj = totalPopProj > 0 ? (age_65plus_proj / totalPopProj) * 100 : 0;
        
        // Calculate point changes
        const change_0_17 = pct_0_17_proj - pct_0_17_curr;
        const change_18_34 = pct_18_34_proj - pct_18_34_curr;
        const change_35_54 = pct_35_54_proj - pct_35_54_curr;
        const change_55_64 = pct_55_64_proj - pct_55_64_curr;
        const change_65plus = pct_65plus_proj - pct_65plus_curr;
        
        console.log('Age percentage shifts:', {
          '0-17': change_0_17.toFixed(2) + ' pts',
          '18-34': change_18_34.toFixed(2) + ' pts',
          '35-54': change_35_54.toFixed(2) + ' pts',
          '55-64': change_55_64.toFixed(2) + ' pts',
          '65+': change_65plus.toFixed(2) + ' pts'
        });
        
        // Populate Age Group Shifts table
        // Ages 0-17
        setIfExists(doc, "age-shift-0-17-curr", pct_0_17_curr.toFixed(1) + "%");
        setIfExists(doc, "age-shift-0-17-proj", pct_0_17_proj.toFixed(1) + "%");
        setIfExists(doc, "age-shift-0-17-trend", (change_0_17 >= 0 ? "+" : "") + change_0_17.toFixed(1) + " pts");
        
        // Ages 18-34
        setIfExists(doc, "age-shift-18-34-curr", pct_18_34_curr.toFixed(1) + "%");
        setIfExists(doc, "age-shift-18-34-proj", pct_18_34_proj.toFixed(1) + "%");
        setIfExists(doc, "age-shift-18-34-trend", (change_18_34 >= 0 ? "+" : "") + change_18_34.toFixed(1) + " pts");
        
        // Ages 35-54
        setIfExists(doc, "age-shift-35-54-curr", pct_35_54_curr.toFixed(1) + "%");
        setIfExists(doc, "age-shift-35-54-proj", pct_35_54_proj.toFixed(1) + "%");
        setIfExists(doc, "age-shift-35-54-trend", (change_35_54 >= 0 ? "+" : "") + change_35_54.toFixed(1) + " pts");
        
        // Ages 55-64
        setIfExists(doc, "age-shift-55-64-curr", pct_55_64_curr.toFixed(1) + "%");
        setIfExists(doc, "age-shift-55-64-proj", pct_55_64_proj.toFixed(1) + "%");
        setIfExists(doc, "age-shift-55-64-trend", (change_55_64 >= 0 ? "+" : "") + change_55_64.toFixed(1) + " pts");
        
        // Ages 65+
        setIfExists(doc, "age-shift-65plus-curr", pct_65plus_curr.toFixed(1) + "%");
        setIfExists(doc, "age-shift-65plus-proj", pct_65plus_proj.toFixed(1) + "%");
        setIfExists(doc, "age-shift-65plus-trend", (change_65plus >= 0 ? "+" : "") + change_65plus.toFixed(1) + " pts");
        
        // Apply CSS classes for trend direction
        const applyTrendClass = (id, change) => {
          const element = doc.getElementById(id);
          if (element) {
            if (change > 0.1) {
              element.className = 'trend-positive';
            } else if (change < -0.1) {
              element.className = 'trend-negative';
            } else {
              element.className = 'trend-neutral';
            }
          }
        };
        
        applyTrendClass("age-shift-0-17-trend", change_0_17);
        applyTrendClass("age-shift-18-34-trend", change_18_34);
        applyTrendClass("age-shift-35-54-trend", change_35_54);
        applyTrendClass("age-shift-55-64-trend", change_55_64);
        applyTrendClass("age-shift-65plus-trend", change_65plus);
      }
      // ===== END AGE GROUP SHIFTS =====
  
  
    }
  });
    
}
  console.log("populateAllDemographics completed");


/* =========================================================
   7) Helpers
   ========================================================= */
function setIfExists(doc, id, value) {
  const element = doc.getElementById(id);
  if (element) element.textContent = value;
}

function formatNumber(num) {
  if (typeof num !== "number" || isNaN(num)) return "0";
  return num.toLocaleString("en-US");
}

/* =========================================================
   8) Fallback: Estimated data if no data found
   ========================================================= */
function getEstimatedDataForRadius(radiusMiles) {
  const basePopulation = 15000 * radiusMiles;

  return {
    population: Math.round(basePopulation),
    households: Math.round(basePopulation * 0.35),
    families: Math.round(basePopulation * 0.23),
    medianIncome: 65000,
    perCapitaIncome: 38000,

    age_0_17: Math.round(basePopulation * 0.157),
    age_18_34: Math.round(basePopulation * 0.241),
    age_35_54: Math.round(basePopulation * 0.272),
    age_55_64: Math.round(basePopulation * 0.189),
    age_65plus: Math.round(basePopulation * 0.143),

    income: {
      "Under $25,000": Math.round(basePopulation * 0.35 * 0.128),
      "$25,000 - $49,999": Math.round(basePopulation * 0.35 * 0.207),
      "$50,000 - $74,999": Math.round(basePopulation * 0.35 * 0.221),
      "$75,000 - $99,999": Math.round(basePopulation * 0.35 * 0.171),
      "$100,000 - $149,999": Math.round(basePopulation * 0.35 * 0.154),
      "$150,000+": Math.round(basePopulation * 0.35 * 0.118),
    },

    employment: {
      "Labor Force Participation Rate": { local: 63.5, usa: 63.4 },
      "Unemployment Rate": { local: 3.8, usa: 3.7 },
      "Bachelor's Degree or Higher": { local: 32.1, usa: 32.6 },
      "High School Graduate or Higher": { local: 88.9, usa: 88.5 },
      "Professional/Management Occupations": { local: 38.2, usa: 37.5 },
    },

    housing: {
      totalUnits: Math.round(basePopulation * 0.38),
      medianValue: 285000,
      medianRent: 1450,
    },

    pop2026: Math.round(basePopulation * 1.02),
    pop2031: Math.round(basePopulation * 1.08),
  };
}



