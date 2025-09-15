class ElectionMap {
    constructor() {
        this.currentYear = '2024';
        this.currentLevel = 'national'; // 'national', 'state', 'statewide', 'county'
        this.currentState = null;
        this.currentCounty = null;
        this.electionData = new Map();
        this.stateResults = new Map();
        this.countyResults = new Map();
        this.svg = null;
        this.g = null;
        this.projection = null;
        this.path = null;
        this.topology = null;
        this.countiesTopology = null;
        
        // Alaska district FIPS to real Alaska borough FIPS mapping
        this.alaskaFipsMapping = {
            '2001': '02240', '2002': '02290', '2003': '02180', '2004': '02188', '2005': '02185',
            '2006': '02090', '2007': '02068', '2008': '02170', '2009': '02020', '2010': '02261',
            '2011': '02122', '2012': '02150', '2013': '02164', '2014': '02060', '2015': '02070',
            '2016': '02050', '2017': '02270', '2018': '02013', '2019': '02016', '2020': '02220',
            '2021': '02100', '2022': '02110', '2023': '02230', '2024': '02282', '2025': '02275',
            '2026': '02195', '2027': '02198', '2028': '02130', '2029': '02105', '2030': '02063',
            '2031': '02066', '2032': '02158'
        };
        
        // Georgia FIPS code corrections for data inconsistencies
        this.georgiaFipsMapping = {
            '13211': '13209'  // Morgan County: TopoJSON uses 13211, 2024 data uses 13209
        };
        this.tooltip = null;
        this.zoom = null;
        
        // Performance optimization: cache and lazy loading
        this.processedYears = new Set();
        this.rawCsvData = null;
        this.renderCache = new Map();
        this.debounceTimeout = null;
        this.navigationTimeout = null;
        this.fipsMatchCache = new Map(); // Cache FIPS format matching results
        
        // State-based lazy loading
        this.processedStateData = new Map(); // Track processed state+year combinations
        this.stateCountyData = new Map(); // Cache county data by state+year
        
        // Performance caches for county rendering
        this.stateCountiesCache = new Map(); // Cache TopoJSON county features by state
        this.countyFipsCache = new Map(); // Cache FIPS format mappings
        this.countyPathCache = new Map(); // Cache pre-computed SVG paths by state
        this.countyBoundsCache = new Map(); // Cache county bounds for zoom operations
        
        // Add cache clearing method
        this.clearPerformanceCaches = () => {
            this.stateCountiesCache.clear();
            this.countyFipsCache.clear();
            this.fipsMatchCache.clear();
            this.countyPathCache.clear();
            this.countyBoundsCache.clear();
            console.log('All performance caches cleared (including path and bounds cache)');
        };
        
        this.init();
    }

    async init() {
        console.log('Starting map initialization...');
        try {
            console.log('Setting up SVG...');
            this.setupSVG();
            
            console.log('Creating tooltip...');
            this.createTooltip();
            
            console.log('Setting up event listeners...');
            this.setupEventListeners();
            
            console.log('Loading topology...');
            await this.loadTopology();
            
            console.log('Loading election data...');
            await this.loadElectionData();
            
            console.log('Rendering national view...');
            this.renderNationalView();
            
            console.log('Updating sidebar...');
            this.updateSidebar();
            
            console.log('Updating breadcrumb...');
            this.updateBreadcrumb();
            
            console.log('Map initialization complete!');
        } catch (error) {
            console.error('Error initializing map:', error);
            this.showError('Failed to load map data. Please ensure all files are accessible via HTTP server.');
        }
    }

    setupSVG() {
        const container = document.getElementById('map-container');
        const rect = container.getBoundingClientRect();
        
        this.svg = d3.select('#map')
            .attr('width', rect.width)
            .attr('height', rect.height);
            
        this.g = this.svg.append('g');
        
        // Setup projection for US map - AlbersUsa is optimized for US maps
        this.projection = d3.geoAlbersUsa()
            .scale(Math.min(rect.width, rect.height) * 1.0)
            .translate([rect.width / 2, rect.height / 2]);
            
        this.path = d3.geoPath().projection(this.projection);
        
        // Add zoom behavior
        this.zoom = d3.zoom()
            .scaleExtent([0.5, 20])
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
            });
            
        this.svg.call(this.zoom);
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
    }

    createTooltip() {
        this.tooltip = d3.select('body').append('div')
            .attr('class', 'tooltip')
            .style('opacity', 0);
    }

    setupEventListeners() {
        document.getElementById('yearSelect').addEventListener('change', async (e) => {
            const newYear = e.target.value;
            if (newYear === this.currentYear) return;
            
            // Show loading state
            this.showLoading();
            
            try {
                this.currentYear = newYear;
                
                // Lazy load data for the new year if not already processed
                await this.processYearData(newYear);
                
                // Update views
                this.updateCurrentView();
                this.updateSidebar();
            } catch (error) {
                console.error('Error changing year:', error);
                this.showError(`Failed to load ${newYear} data`);
            } finally {
                this.hideLoading();
            }
        });
        
        // Mobile swipe functionality
        this.setupMobileSwipe();
        
        // Breadcrumb navigation
        document.getElementById('breadcrumb-national').addEventListener('click', () => {
            this.navigateToNational();
        });
        
        document.getElementById('breadcrumb-state').addEventListener('click', () => {
            if (this.currentState) {
                this.navigateToState(this.currentState);
            }
        });
        
        document.getElementById('breadcrumb-statewide').addEventListener('click', async () => {
            if (this.currentState) {
                await this.navigateToStatewide(this.currentState);
            }
        });
        
        // Drill-up button
        document.getElementById('drillUpButton').addEventListener('click', async () => {
            await this.drillUp();
        });
    }
    
    setupMobileSwipe() {
        const sidebar = document.querySelector('.sidebar');
        const sidebarHandle = document.querySelector('.sidebar-handle');
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        let isExpanded = false;
        
        // Check if device is mobile
        const isMobile = window.innerWidth <= 768;
        if (!isMobile) return;
        
        // Touch start
        const handleTouchStart = (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
            this.dragStartTime = Date.now();
            sidebar.style.transition = 'none';
            document.body.classList.add('sidebar-dragging');
        };
        
        // Touch move
        const handleTouchMove = (e) => {
            if (!isDragging) return;
            
            e.preventDefault(); // Prevent scrolling while dragging
            currentY = e.touches[0].clientY;
            const deltaY = startY - currentY;
            
            // Calculate new position with smoother boundaries
            const maxHeight = sidebar.offsetHeight - 60;
            let newTranslateY;
            
            if (isExpanded) {
                // When expanded, allow dragging down with resistance
                newTranslateY = Math.min(0, Math.max(-maxHeight, -deltaY * 0.8));
            } else {
                // When collapsed, allow dragging up with resistance
                newTranslateY = Math.min(0, Math.max(-maxHeight, -deltaY * 0.8));
            }
            
            const baseTransform = isExpanded ? 0 : maxHeight;
            sidebar.style.transform = `translateY(${baseTransform + newTranslateY}px)`;
        };
        
        // Touch end
        const handleTouchEnd = (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            sidebar.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            document.body.classList.remove('sidebar-dragging');
            
            const deltaY = startY - currentY;
            const velocity = Math.abs(deltaY) / (Date.now() - this.dragStartTime || 1);
            const threshold = velocity > 0.5 ? 30 : 80; // Lower threshold for fast swipes
            
            // Determine next state based on distance and velocity
            const shouldExpand = deltaY > threshold || (velocity > 0.3 && deltaY > 0);
            const shouldCollapse = deltaY < -threshold || (velocity > 0.3 && deltaY < 0);
            
            if (shouldExpand && !isExpanded) {
                this.expandSidebar();
            } else if (shouldCollapse && isExpanded) {
                this.collapseSidebar();
            } else {
                // Snap back to current state with smoother transition
                if (isExpanded) {
                    this.expandSidebar();
                } else {
                    this.collapseSidebar();
                }
            }
        };
        
        // Handle click on sidebar handle
        const handleHandleClick = () => {
            if (isExpanded) {
                this.collapseSidebar();
            } else {
                this.expandSidebar();
            }
        };
        
        // Expand sidebar
        this.expandSidebar = () => {
            sidebar.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            sidebar.style.transform = 'translateY(0)';
            sidebar.classList.add('expanded');
            isExpanded = true;
        };
        
        // Collapse sidebar
        this.collapseSidebar = () => {
            sidebar.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            sidebar.style.transform = 'translateY(calc(100% - 60px))';
            sidebar.classList.remove('expanded');
            isExpanded = false;
        };
        
        // Add event listeners
        sidebar.addEventListener('touchstart', handleTouchStart, { passive: false });
        sidebar.addEventListener('touchmove', handleTouchMove, { passive: false });
        sidebar.addEventListener('touchend', handleTouchEnd, { passive: false });
        sidebarHandle.addEventListener('click', handleHandleClick);
        
        // Handle window resize
        window.addEventListener('resize', () => {
            const newIsMobile = window.innerWidth <= 768;
            if (newIsMobile !== isMobile) {
                // Reset sidebar state when switching between mobile/desktop
                sidebar.classList.remove('expanded');
                sidebar.style.transform = '';
                sidebar.style.transition = '';
            }
        });
    }

    async loadTopology() {
        try {
            this.topology = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json');
            this.countiesTopology = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
        } catch (error) {
            console.error('Error loading topology:', error);
            throw new Error('Failed to load map topology');
        }
    }

    async loadElectionData() {
        try {
            // Only load raw CSV once, process lazily by year
            if (!this.rawCsvData) {
                console.log('Loading election data...');
                this.rawCsvData = await d3.csv('./data/countypres_2000-2024.csv');
                console.log(`Loaded ${this.rawCsvData.length} records`);
            }
            
            // Process only the current year on first load
            await this.processYearData(this.currentYear);
        } catch (error) {
            console.error('Error loading election data:', error);
            throw new Error('Failed to load election data');
        }
    }

    async processYearData(year) {
        if (this.processedYears.has(year) || !this.rawCsvData) {
            return; // Already processed or no data
        }

        console.log(`Processing data for ${year}...`);
        
        // Filter CSV data to only the requested year
        const yearData = this.rawCsvData.filter(d => d.year === year);
        console.log(`Processing ${yearData.length} records for ${year}`);
        
        // Process only this year's data
        this.processElectionData(yearData, year);
        this.processedYears.add(year);
        
        console.log(`Completed processing ${year}`);
    }

    async processStateCountyData(year, stateName) {
        const cacheKey = `${year}-${stateName}`;
        if (this.processedStateData.has(cacheKey)) {
            return; // Already processed this state+year
        }

        if (!this.rawCsvData) {
            console.warn('CSV data not loaded yet');
            return;
        }

        console.time(`Processing county data for ${stateName} ${year}`);
        
        // Filter to only this year + state combination
        const stateYearData = this.rawCsvData.filter(d => 
            d.year === year && d.state === stateName
        );
        
        // Process this state's county data specifically
        this.processStateElectionData(stateYearData, year, stateName);
        this.processedStateData.set(cacheKey, true);
        
        console.timeEnd(`Processing county data for ${stateName} ${year}`);
    }

    processStateElectionData(csvData, targetYear, targetState) {
        // Process county data for a specific state+year combination
        const rawData = new Map();
        
        csvData.forEach(d => {
            const year = d.year;
            const state = d.state;
            let county = d.county_fips;
            const candidate = d.candidate;
            const party = this.normalizeParty(d.party);
            const votes = parseInt(d.candidatevotes);
            const mode = d.mode || 'TOTAL';
            
            // Skip invalid data
            if (year === 'year' || !county || !votes || votes < 0) return;
            if (candidate === 'TOTAL VOTES CAST' || candidate === '') return;
            
            // Skip overvotes and undervotes (comprehensive check)
            const candidateUpper = candidate.toUpperCase().trim();
            if (candidateUpper === 'OVERVOTES' || candidateUpper === 'UNDERVOTES' || 
                candidateUpper === 'OVER VOTES' || candidateUpper === 'UNDER VOTES' ||
                candidateUpper.includes('OVERVOTE') || candidateUpper.includes('UNDERVOTE')) return;
            
            // Special handling for Rhode Island: aggregate to county level
            if (state === 'RHODE ISLAND' && county && county.length === 10) {
                county = county.substring(0, 5);
            }
            
            // Initialize nested structure
            if (!rawData.has(year)) rawData.set(year, new Map());
            if (!rawData.get(year).has(state)) rawData.get(year).set(state, new Map());
            if (!rawData.get(year).get(state).has(county)) {
                rawData.get(year).get(state).set(county, { modes: new Map(), name: d.county_name });
            }
            
            const countyData = rawData.get(year).get(state).get(county);
            if (!countyData.modes.has(mode)) countyData.modes.set(mode, new Map());
            if (!countyData.modes.get(mode).has(party)) countyData.modes.get(mode).set(party, 0);
            
            countyData.modes.get(mode).set(party, countyData.modes.get(mode).get(party) + votes);
        });
        
        // Process and store county results for this state
        this.processStateRawData(rawData, targetYear, targetState);
    }

    processStateRawData(rawData, targetYear, targetState) {
        rawData.forEach((yearData, year) => {
            if (!this.electionData.has(year)) this.electionData.set(year, new Map());
            if (!this.countyResults.has(year)) this.countyResults.set(year, new Map());
            
            yearData.forEach((stateData, state) => {
                if (state !== targetState) return; // Only process target state
                
                if (!this.electionData.get(year).has(state)) this.electionData.get(year).set(state, new Map());
                
                stateData.forEach((countyData, county) => {
                    const modes = countyData.modes;
                    const finalVotes = new Map();
                    
                    // Determine which modes to use (prefer TOTAL VOTES > TOTAL > component modes)
                    if (modes.has('TOTAL VOTES')) {
                        modes.get('TOTAL VOTES').forEach((votes, party) => {
                            finalVotes.set(party, votes);
                        });
                    } else if (modes.has('TOTAL')) {
                        modes.get('TOTAL').forEach((votes, party) => {
                            finalVotes.set(party, votes);
                        });
                    } else {
                        const modesToSum = Array.from(modes.keys()).filter(mode => 
                            !['EARLY VOTING', 'LATE EARLY VOTING', 'ELECTION DAY', 'PROVISIONAL', 'ABSENTEE', 'MAIL-IN', 'ABSENTEE BY MAIL'].includes(mode) ||
                            (!modes.has('TOTAL VOTES') && !modes.has('TOTAL'))
                        );
                        
                        modesToSum.forEach(mode => {
                            modes.get(mode).forEach((votes, party) => {
                                finalVotes.set(party, (finalVotes.get(party) || 0) + votes);
                            });
                        });
                    }
                    
                    // Convert to array format
                    const candidateArray = [];
                    finalVotes.forEach((votes, party) => {
                        candidateArray.push({
                            candidate: party,
                            party: party,
                            votes: votes,
                            countyName: countyData.name,
                            mode: 'PROCESSED'
                        });
                    });
                    
                    this.electionData.get(year).get(state).set(county, candidateArray);
                    
                    // Calculate county results
                    const countyVotes = new Map();
                    let countyName = 'Unknown County';
                    
                    candidateArray.forEach(candidate => {
                        const currentVotes = countyVotes.get(candidate.party) || 0;
                        countyVotes.set(candidate.party, currentVotes + candidate.votes);
                        if (candidate.countyName) {
                            countyName = candidate.countyName;
                        }
                    });
                    
                    const countyWinner = this.determineWinner(countyVotes);
                    
                    // Handle Alaska district mapping
                    let storageKey = county;
                    if (state === 'ALASKA' && this.alaskaFipsMapping[county]) {
                        storageKey = this.alaskaFipsMapping[county];
                    }
                    
                    // Convert Map to object for storage
                    const countyVotesObj = {};
                    countyVotes.forEach((votes, party) => {
                        countyVotesObj[party] = votes;
                    });
                    
                    this.countyResults.get(year).set(storageKey, {
                        winner: countyWinner,
                        votes: countyVotesObj,
                        state: state,
                        name: countyName,
                        candidates: candidateArray
                    });
                });
            });
        });
    }

    processElectionData(csvData, targetYear = null) {
        // Process raw data by mode to handle double counting properly (MagicWall approach)
        const rawData = new Map();
        
        csvData.forEach(d => {
            const year = d.year;
            const state = d.state;
            let county = d.county_fips;
            const candidate = d.candidate;
            const party = this.normalizeParty(d.party);
            const votes = parseInt(d.candidatevotes);
            const mode = d.mode || 'TOTAL';
            
            // Skip header row and invalid data
            if (year === 'year' || !county || !votes || votes < 0) return;
            if (candidate === 'TOTAL VOTES CAST' || candidate === '') return;
            
            // Skip overvotes and undervotes (comprehensive check)
            const candidateUpper = candidate.toUpperCase().trim();
            if (candidateUpper === 'OVERVOTES' || candidateUpper === 'UNDERVOTES' || 
                candidateUpper === 'OVER VOTES' || candidateUpper === 'UNDER VOTES' ||
                candidateUpper.includes('OVERVOTE') || candidateUpper.includes('UNDERVOTE')) return;
            
            // Special handling for Rhode Island: aggregate to county level
            if (state === 'RHODE ISLAND' && county && county.length === 10) {
                county = county.substring(0, 5);
            }
            
            // Initialize nested structure
            if (!rawData.has(year)) rawData.set(year, new Map());
            if (!rawData.get(year).has(state)) rawData.get(year).set(state, new Map());
            if (!rawData.get(year).get(state).has(county)) {
                rawData.get(year).get(state).set(county, { modes: new Map(), name: d.county_name });
            }
            
            const countyData = rawData.get(year).get(state).get(county);
            if (!countyData.modes.has(mode)) countyData.modes.set(mode, new Map());
            if (!countyData.modes.get(mode).has(party)) countyData.modes.get(mode).set(party, 0);
            
            countyData.modes.get(mode).set(party, countyData.modes.get(mode).get(party) + votes);
        });
        
        // Process modes to avoid double counting (following MagicWall logic)
        rawData.forEach((yearData, year) => {
            if (!this.electionData.has(year)) this.electionData.set(year, new Map());
            
            yearData.forEach((stateData, state) => {
                if (!this.electionData.get(year).has(state)) this.electionData.get(year).set(state, new Map());
                
                stateData.forEach((countyData, county) => {
                    const modes = countyData.modes;
                    const finalVotes = new Map();
                    
                    // Determine which modes to use (prefer TOTAL VOTES > TOTAL > component modes)
                    if (modes.has('TOTAL VOTES')) {
                        // Use TOTAL VOTES if available (includes early voting, election day, etc.)
                        modes.get('TOTAL VOTES').forEach((votes, party) => {
                            finalVotes.set(party, votes);
                        });
                    } else if (modes.has('TOTAL')) {
                        // Use TOTAL if available (legacy format)
                        modes.get('TOTAL').forEach((votes, party) => {
                            finalVotes.set(party, votes);
                        });
                    } else {
                        // Sum component modes, but avoid double counting
                        // Skip modes that are subsets of others when TOTAL VOTES or TOTAL exist
                        const modesToSum = Array.from(modes.keys()).filter(mode => 
                            !['EARLY VOTING', 'LATE EARLY VOTING', 'ELECTION DAY', 'PROVISIONAL', 'ABSENTEE', 'MAIL-IN', 'ABSENTEE BY MAIL'].includes(mode) ||
                            (!modes.has('TOTAL VOTES') && !modes.has('TOTAL'))
                        );
                        
                        modesToSum.forEach(mode => {
                            modes.get(mode).forEach((votes, party) => {
                                finalVotes.set(party, (finalVotes.get(party) || 0) + votes);
                            });
                        });
                    }
                    
                    // Convert to array format for calculateResults
                    const candidateArray = [];
                    finalVotes.forEach((votes, party) => {
                        candidateArray.push({
                            candidate: party, // We'll use party as candidate name at this level
                            party: party,
                            votes: votes,
                            countyName: countyData.name,
                            mode: 'PROCESSED'
                        });
                    });
                    
                    this.electionData.get(year).get(state).set(county, candidateArray);
                });
            });
        });
        
        this.calculateResults();
    }

    normalizeParty(party) {
        const partyLower = party.toLowerCase();
        if (partyLower.includes('republican') || partyLower.includes('gop')) {
            return 'REPUBLICAN';
        } else if (partyLower.includes('democrat')) {
            return 'DEMOCRAT';
        } else {
            // Return the actual party name instead of lumping into "OTHER"
            return party.toUpperCase().trim();
        }
    }

    calculateResults() {
        this.electionData.forEach((yearData, year) => {
            if (!this.stateResults.has(year)) {
                this.stateResults.set(year, new Map());
            }
            if (!this.countyResults.has(year)) {
                this.countyResults.set(year, new Map());
            }
            
            yearData.forEach((stateData, stateName) => {
                const stateVotes = new Map();
                
                stateData.forEach((countyData, countyFips) => {
                    const countyVotes = new Map();
                    let countyName = 'Unknown County';
                    
                    countyData.forEach(candidate => {
                        const currentCountyVotes = countyVotes.get(candidate.party) || 0;
                        countyVotes.set(candidate.party, currentCountyVotes + candidate.votes);
                        const currentStateVotes = stateVotes.get(candidate.party) || 0;
                        stateVotes.set(candidate.party, currentStateVotes + candidate.votes);
                        if (candidate.countyName) {
                            countyName = candidate.countyName;
                        }
                    });
                    
                    const countyWinner = this.determineWinner(countyVotes);
                    
                    // Handle Alaska district mapping: convert district FIPS (2001, 2010) to borough FIPS (02240, 02261)
                    let storageKey = countyFips;
                    if (stateName === 'ALASKA' && this.alaskaFipsMapping[countyFips]) {
                        storageKey = this.alaskaFipsMapping[countyFips];
                        console.log(`Alaska: mapped district ${countyFips} to borough ${storageKey}`);
                    }
                    
                    // Convert Map to object for storage
                    const countyVotesObj = {};
                    countyVotes.forEach((votes, party) => {
                        countyVotesObj[party] = votes;
                    });
                    
                    this.countyResults.get(year).set(storageKey, {
                        winner: countyWinner,
                        votes: countyVotesObj,
                        state: stateName,
                        name: countyName,
                        candidates: countyData
                    });
                });
                
                const stateWinner = this.determineWinner(stateVotes);
                
                // Convert Map to object for storage
                const stateVotesObj = {};
                stateVotes.forEach((votes, party) => {
                    stateVotesObj[party] = votes;
                });
                
                this.stateResults.get(year).set(stateName, {
                    winner: stateWinner,
                    votes: stateVotesObj
                });
                
                // Debug logging for Alabama 2024 FIPS codes
                if (year === '2024' && stateName === 'ALABAMA') {
                    const alabamaKeys = Array.from(this.countyResults.get(year).keys()).filter(fips => {
                        const result = this.countyResults.get(year).get(fips);
                        return result && result.state === 'ALABAMA';
                    }).slice(0, 10);
                    console.log('Alabama 2024 county FIPS stored:', alabamaKeys);
                    console.log('Sample key format:', typeof alabamaKeys[0], alabamaKeys[0]);
                }
            });
        });
    }

    determineWinner(votes) {
        let maxVotes = 0;
        let winner = 'UNKNOWN';
        
        // Handle both Map objects and regular objects for backwards compatibility
        const entries = votes instanceof Map ? votes.entries() : Object.entries(votes);
        
        for (const [party, voteCount] of entries) {
            if (voteCount > maxVotes) {
                maxVotes = voteCount;
                winner = party;
            }
        }
        
        return winner;
    }

    // Navigation methods
    navigateToNational() {
        if (this.currentLevel === 'national') return; // Skip if already there
        
        this.currentLevel = 'national';
        this.currentState = null;
        this.currentCounty = null;
        this.performNavigation();
    }

    navigateToState(stateName) {
        if (this.currentLevel === 'state' && this.currentState === stateName) return;
        
        this.currentLevel = 'state';
        this.currentState = stateName;
        this.currentCounty = null;
        this.performNavigation();
    }

    async navigateToStatewide(stateName) {
        if (this.currentLevel === 'statewide' && this.currentState === stateName) return;
        
        // Show loading state immediately
        this.showStateLoadingIndicator(stateName);
        
        this.currentLevel = 'statewide';
        this.currentState = stateName;
        this.currentCounty = null;
        
        try {
            // Ensure county data is loaded for this state+year
            await this.processStateCountyData(this.currentYear, stateName);
            
            this.performNavigation();
        } catch (error) {
            console.error(`Error loading county data for ${stateName}:`, error);
            this.showError(`Failed to load county data for ${stateName}`);
        } finally {
            this.hideStateLoadingIndicator();
        }
    }

    async navigateToCounty(stateName, countyFips) {
        if (this.currentLevel === 'county' && this.currentState === stateName && this.currentCounty === countyFips) return;
        
        this.currentLevel = 'county';
        this.currentState = stateName;
        this.currentCounty = countyFips;
        
        try {
            // Ensure county data is loaded for this state+year
            await this.processStateCountyData(this.currentYear, stateName);
            
            // Re-enable full navigation with county view
            this.performNavigation();
        } catch (error) {
            console.error(`Error loading county data for ${stateName}:`, error);
            this.showError(`Failed to load county data for ${stateName}`);
        }
    }

    performNavigation() {
        // Batch all navigation updates together with requestAnimationFrame
        if (this.navigationTimeout) {
            clearTimeout(this.navigationTimeout);
        }
        
        this.navigationTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                this.updateCurrentView();
                this.updateSidebar();
                this.updateBreadcrumb();
            });
        }, 10); // Small delay to batch rapid navigation calls
    }

    async drillUp() {
        switch (this.currentLevel) {
            case 'county':
                // County > State-wide
                await this.navigateToStatewide(this.currentState);
                break;
            case 'statewide':
                // State-wide > State
                this.navigateToState(this.currentState);
                break;
            case 'state':
                // State > National
                this.navigateToNational();
                break;
            case 'national':
                // Already at top level, do nothing
                break;
        }
    }

    // Render methods for each view
    renderNationalView() {
        this.g.selectAll('*').remove();
        this.lastRenderedCounty = null; // Reset county cache when leaving county view
        
        const yearResults = this.stateResults.get(this.currentYear) || new Map();
        
        this.g.selectAll('.state')
            .data(topojson.feature(this.topology, this.topology.objects.states).features)
            .enter().append('path')
            .attr('class', 'state')
            .attr('d', this.path)
            .attr('fill', d => {
                const stateName = this.getStateName(d.id);
                const result = yearResults.get(stateName);
                return result ? this.getPartyColor(result.winner) : '#666';
            })
            .on('click', (event, d) => {
                const stateName = this.getStateName(d.id);
                this.navigateToState(stateName);
            })
            .on('mouseover', (event, d) => {
                const stateName = this.getStateName(d.id);
                const result = yearResults.get(stateName);
                this.showStateTooltip(event, stateName, result);
            })
            .on('mouseout', () => {
                this.hideTooltip();
            });
            
        // Reset zoom to national view
        this.svg.transition()
            .duration(750)
            .call(this.zoom.transform, d3.zoomIdentity);
    }

    renderStateView() {
        this.g.selectAll('*').remove();
        this.lastRenderedCounty = null; // Reset county cache when leaving county view
        
        // Find the state feature
        const stateFeature = topojson.feature(this.topology, this.topology.objects.states).features
            .find(d => this.getStateName(d.id) === this.currentState);
            
        if (!stateFeature) return;
        
        // Calculate bounds and zoom to state with padding
        const bounds = this.path.bounds(stateFeature);
        this.zoomToBounds(bounds, 0.8); // 0.8 for padding
        
        // Draw the state as a single colored region
        this.g.selectAll('.state')
            .data([stateFeature])
            .enter().append('path')
            .attr('class', 'state')
            .attr('d', this.path)
            .attr('fill', () => {
                const result = this.stateResults.get(this.currentYear)?.get(this.currentState);
                return result ? this.getPartyColor(result.winner) : '#666';
            })
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.25)
            .on('click', async () => {
                await this.navigateToStatewide(this.currentState);
            });
    }

    getStateCounties(stateName) {
        // Cache TopoJSON county features by state to avoid repeated processing
        if (this.stateCountiesCache.has(stateName)) {
            return this.stateCountiesCache.get(stateName);
        }
        
        const stateCounties = topojson.feature(this.countiesTopology, this.countiesTopology.objects.counties).features
            .filter(d => {
                const stateFips = Math.floor(d.id / 1000).toString().padStart(2, '0');
                const featureStateName = this.getStateNameFromFips(stateFips);
                return featureStateName && featureStateName === stateName;
            });
            
        this.stateCountiesCache.set(stateName, stateCounties);
        
        // OPTION C: Pre-compute SVG paths for this state's counties
        this.preComputeCountyPaths(stateName, stateCounties);
        
        return stateCounties;
    }
    
    preComputeCountyPaths(stateName, stateCounties) {
        // Check if paths already computed for this state
        if (this.countyPathCache.has(stateName)) {
            return;
        }
        
        console.log(`Pre-computing paths for ${stateCounties.length} counties in ${stateName}`);
        const statePaths = new Map();
        
        stateCounties.forEach(county => {
            const pathString = this.path(county);
            statePaths.set(county.id.toString(), pathString);
        });
        
        this.countyPathCache.set(stateName, statePaths);
        console.log(`Cached ${statePaths.size} county paths for ${stateName}`);
    }
    
    getCountyPath(stateName, countyId) {
        const statePaths = this.countyPathCache.get(stateName);
        return statePaths ? statePaths.get(countyId.toString()) : null;
    }

    renderStatewideView() {
        this.g.selectAll('*').remove();
        this.lastRenderedCounty = null; // Reset county cache when leaving county view
        
        // Use cached county features
        const stateCounties = this.getStateCounties(this.currentState);
        
        if (stateCounties.length === 0) {
            console.warn(`No county data found for ${this.currentState}`);
            this.navigateToNational();
            return;
        }
        
        // Maintain the same zoom level as state view
        const stateFeature = topojson.feature(this.topology, this.topology.objects.states).features
            .find(d => this.getStateName(d.id) === this.currentState);
        if (stateFeature) {
            const bounds = this.path.bounds(stateFeature);
            this.zoomToBounds(bounds, 0.8);
        }
        
        // Pre-compute lookups for statewide view performance
        const statewideCountyLookups = new Map();
        stateCounties.forEach(county => {
            const topoId = county.id.toString();
            const lookup = this.findCountyFips(topoId, this.currentState);
            statewideCountyLookups.set(topoId, lookup);
        });
        
        // Draw counties
        this.g.selectAll('.county')
            .data(stateCounties)
            .enter().append('path')
            .attr('class', 'county')
            .attr('d', d => {
                // OPTION C: Use cached paths in statewide view too
                const cachedPath = this.getCountyPath(this.currentState, d.id);
                return cachedPath || this.path(d);
            })
            .attr('fill', d => {
                const lookup = statewideCountyLookups.get(d.id.toString());
                return lookup ? this.getPartyColor(lookup.result.winner) : '#666';
            })
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.15)
            .on('click', async (event, d) => {
                const topoId = d.id.toString();
                const lookup = statewideCountyLookups.get(topoId);
                
                // For Alaska, also check if this TopoJSON ID matches a mapped borough
                let countyFips = lookup?.format;
                if (!countyFips && this.currentState === 'ALASKA') {
                    const result = this.countyResults.get(this.currentYear)?.get(topoId);
                    if (result && result.state === this.currentState) {
                        countyFips = topoId;
                    }
                }
                
                if (countyFips) {
                    await this.navigateToCounty(this.currentState, countyFips);
                } else {
                    console.warn(`No county data found for TopoJSON ID: ${topoId} in ${this.currentState}`);
                    console.log('Available county results for this state:', 
                        Array.from(this.countyResults.get(this.currentYear)?.keys() || [])
                            .filter(fips => {
                                const result = this.countyResults.get(this.currentYear)?.get(fips);
                                return result && result.state === this.currentState;
                            }).slice(0, 10)
                    );
                }
            })
            .on('mouseover', (event, d) => {
                const lookup = statewideCountyLookups.get(d.id.toString());
                
                if (lookup?.result) {
                    this.showCountyTooltip(event, lookup.result);
                }
            })
            .on('mouseout', () => {
                this.hideTooltip();
            });
    }

    findCountyFips(topoId, stateName) {
        // Cache FIPS format matching results to avoid repeated computation
        const cacheKey = `${this.currentYear}-${stateName}-${topoId}`; // Include year in cache key
        if (this.countyFipsCache.has(cacheKey)) {
            return this.countyFipsCache.get(cacheKey);
        }
        
        // Apply Georgia FIPS code corrections if needed
        let correctedTopoId = topoId;
        if (stateName === 'GEORGIA' && this.georgiaFipsMapping[topoId]) {
            correctedTopoId = this.georgiaFipsMapping[topoId];
            console.log(`Georgia FIPS correction: ${topoId} -> ${correctedTopoId}`);
        }
        
        const formats = [
            correctedTopoId,                           // "01009" - full 5-digit (possibly corrected)
            topoId,                                    // Original TopoJSON ID as fallback
            parseInt(correctedTopoId).toString(),      // "1009" - remove leading zero
            correctedTopoId.substring(2),              // "009" - county part only  
            parseInt(correctedTopoId.substring(2)).toString() // "9" - county without leading zeros
        ];
        
        let result = null;
        for (const format of formats) {
            const countyResult = this.countyResults.get(this.currentYear)?.get(format);
            if (countyResult && countyResult.state === stateName) {
                result = { format, result: countyResult };
                break;
            }
        }
        
        // Debug logging for failed lookups
        if (!result && stateName === 'GEORGIA') {
            console.warn(`Georgia county lookup failed for TopoJSON ID: ${topoId}`);
            console.log('Tried formats:', formats);
            console.log('Sample Georgia FIPS in data:', 
                Array.from(this.countyResults.get(this.currentYear)?.keys() || [])
                    .filter(fips => {
                        const countyResult = this.countyResults.get(this.currentYear)?.get(fips);
                        return countyResult && countyResult.state === 'GEORGIA';
                    }).slice(0, 5)
            );
        }
        
        // Cache both successful and failed lookups
        this.countyFipsCache.set(cacheKey, result);
        return result;
    }

    renderCountyView() {
        // Performance check: skip full re-render if we're already showing this county
        if (this.lastRenderedCounty === `${this.currentState}-${this.currentCounty}`) {
            // Just update the selected county styling
            this.g.selectAll('.county')
                .attr('stroke-width', d => {
                    const lookup = this.findCountyFips(d.id.toString(), this.currentState);
                    return (lookup && lookup.format === this.currentCounty) ? 2 : 0.15;
                })
                .classed('selected-county', d => {
                    const lookup = this.findCountyFips(d.id.toString(), this.currentState);
                    return lookup && lookup.format === this.currentCounty;
                });
            return;
        }
        
        // Use cached county features
        const stateCounties = this.getStateCounties(this.currentState);
        
        // OPTIMIZED: Single loop to pre-compute lookups AND find selected county
        const countyLookups = new Map();
        let selectedCountyFeature = null;
        
        stateCounties.forEach(county => {
            const topoId = county.id.toString();
            const lookup = this.findCountyFips(topoId, this.currentState);
            countyLookups.set(topoId, lookup);
            
            // While we're looping, find the selected county
            if (!selectedCountyFeature && lookup && lookup.format === this.currentCounty) {
                selectedCountyFeature = county;
            }
        });
            
        if (!selectedCountyFeature) {
            console.error(`County view: could not find county feature for FIPS ${this.currentCounty}`);
            return;
        }
        
        // Zoom to the selected county with fast transition and cached bounds
        const cacheKey = `${this.currentState}-${this.currentCounty}`;
        let bounds = this.countyBoundsCache.get(cacheKey);
        if (!bounds) {
            bounds = this.path.bounds(selectedCountyFeature);
            this.countyBoundsCache.set(cacheKey, bounds);
        }
        this.zoomToBounds(bounds, 0.6, true); // Fast zoom with reduced duration
        
        // OPTION A OPTIMIZATION: Smart DOM updates instead of destroy/rebuild
        const counties = this.g.selectAll('.county').data(stateCounties, d => d.id);
        
        // Remove counties that no longer exist (rare)
        counties.exit().remove();
        
        // Add new counties (first time or state change)
        const newCounties = counties.enter().append('path')
            .attr('class', 'county')
            .on('click', (event, d) => {
                // Disable county-to-county navigation
                event.stopPropagation();
            })
            .on('mouseover', (event, d) => {
                const lookup = countyLookups.get(d.id.toString());
                
                if (lookup?.result) {
                    const result = lookup.result;
                    this.showTooltip(event, `${result.name}<br/>${result.winner}: ${result.votes[result.winner].toLocaleString()} votes`);
                }
            })
            .on('mouseleave', () => {
                this.hideTooltip();
            });
        
        // Update all counties (new + existing) with current data - optimized
        const allCounties = counties.merge(newCounties);
        const self = this; // Preserve reference to ElectionMap instance
        allCounties.each(function(d) {
            const element = d3.select(this);
            const lookup = countyLookups.get(d.id.toString());
            const isSelected = lookup && lookup.format === self.currentCounty;
            
            // Use cached path if available for better performance
            const cachedPath = self.getCountyPath(self.currentState, d.id);
            
            // Batch all attribute updates to minimize DOM reflow
            element
                .attr('d', cachedPath || self.path(d))
                .attr('fill', lookup ? self.getPartyColor(lookup.result.winner) : '#666')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', isSelected ? 2 : 0.15)
                .classed('selected-county', isSelected);
        });
        
        // Cache the current render to avoid unnecessary re-renders
        this.lastRenderedCounty = `${this.currentState}-${this.currentCounty}`;
    }

    zoomToBounds(bounds, paddingFactor = 0.8, fastTransition = false) {
        const [[x0, y0], [x1, y1]] = bounds;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const x = (x0 + x1) / 2;
        const y = (y0 + y1) / 2;
        
        const container = document.getElementById('map-container');
        const rect = container.getBoundingClientRect();
        
        const scale = Math.min(rect.width / dx, rect.height / dy) * paddingFactor;
        const translate = [rect.width / 2 - scale * x, rect.height / 2 - scale * y];
        
        // Use faster transition for county-to-county navigation
        const duration = fastTransition ? 150 : 750;
        
        this.svg.transition()
            .duration(duration)
            .call(this.zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
    }

    showLoading() {
        const sidebar = document.getElementById('results-summary');
        if (sidebar) {
            sidebar.innerHTML = '<div class="loading">Loading data...</div>';
        }
    }

    hideLoading() {
        // Loading will be replaced by regular content in updateSidebar
    }

    showError(message) {
        const sidebar = document.getElementById('results-summary');
        if (sidebar) {
            sidebar.innerHTML = `<div class="error" style="color: #ff6b6b; padding: 1rem;">${message}</div>`;
        }
    }

    showStateLoadingIndicator(stateName) {
        const sidebar = document.getElementById('results-summary');
        if (sidebar) {
            sidebar.innerHTML = `
                <div class="loading-state" style="padding: 1rem; text-align: center;">
                    <div class="loading-spinner" style="margin: 1rem auto; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <div>Loading ${stateName} county data...</div>
                </div>
            `;
        }
    }

    hideStateLoadingIndicator() {
        // Loading indicator will be replaced by regular content in updateSidebar
    }

    showTooltip(event, content) {
        // Create tooltip only once to avoid DOM manipulation lag
        if (!this.tooltip) {
            this.tooltip = d3.select('body').append('div')
                .attr('class', 'tooltip')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.9)')
                .style('color', 'white')
                .style('padding', '0.5rem')
                .style('border-radius', '4px')
                .style('font-size', '0.8rem')
                .style('pointer-events', 'none')
                .style('z-index', '1001')
                .style('border', '1px solid #555')
                .style('opacity', 0)
                .style('transition', 'none'); // Remove transitions for instant response
        }

        // Update content and position instantly without transitions
        this.tooltip
            .html(content)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .style('opacity', 1);
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style('opacity', 0);
        }
    }

    updateCurrentView() {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
        
        this.debounceTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                switch (this.currentLevel) {
                    case 'national':
                        this.renderNationalView();
                        break;
                    case 'state':
                        this.renderStateView();
                        break;
                    case 'statewide':
                        this.renderStatewideView();
                        break;
                    case 'county':
                        this.renderCountyView();
                        break;
                }
            });
        }, 10);
    }

    updateBreadcrumb() {
        // Reset all breadcrumb items
        document.querySelectorAll('.breadcrumb-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.breadcrumb-separator').forEach(sep => {
            sep.style.display = 'none';
        });
        
        // Update drill-up button visibility
        const drillUpButton = document.getElementById('drillUpButton');
        if (this.currentLevel === 'national') {
            drillUpButton.style.display = 'none';
        } else {
            drillUpButton.style.display = 'inline-block';
        }
        
        // Update based on current level
        document.getElementById('breadcrumb-national').classList.add('active');
        
        if (this.currentLevel !== 'national') {
            document.querySelector('.breadcrumb-separator').style.display = 'inline';
            document.getElementById('breadcrumb-state').style.display = 'inline';
            document.getElementById('breadcrumb-state').textContent = this.currentState;
            document.getElementById('breadcrumb-state').classList.add('active');
            document.getElementById('breadcrumb-national').classList.remove('active');
        }
        
        if (this.currentLevel === 'statewide' || this.currentLevel === 'county') {
            document.querySelectorAll('.breadcrumb-separator')[1].style.display = 'inline';
            document.getElementById('breadcrumb-statewide').style.display = 'inline';
            document.getElementById('breadcrumb-statewide').classList.add('active');
            document.getElementById('breadcrumb-state').classList.remove('active');
        }
        
        if (this.currentLevel === 'county') {
            const countyResult = this.countyResults.get(this.currentYear)?.get(this.currentCounty);
            document.querySelectorAll('.breadcrumb-separator')[2].style.display = 'inline';
            document.getElementById('breadcrumb-county').style.display = 'inline';
            document.getElementById('breadcrumb-county').textContent = countyResult?.name || 'County';
            document.getElementById('breadcrumb-county').classList.add('active');
            document.getElementById('breadcrumb-statewide').classList.remove('active');
        }
        
        // Hide unused elements
        if (this.currentLevel === 'national') {
            document.getElementById('breadcrumb-state').style.display = 'none';
            document.getElementById('breadcrumb-statewide').style.display = 'none';
            document.getElementById('breadcrumb-county').style.display = 'none';
        } else if (this.currentLevel === 'state') {
            document.getElementById('breadcrumb-statewide').style.display = 'none';
            document.getElementById('breadcrumb-county').style.display = 'none';
        } else if (this.currentLevel === 'statewide') {
            document.getElementById('breadcrumb-county').style.display = 'none';
        }
    }


    updateSidebar() {
        document.getElementById('sidebar-title').textContent = this.getSidebarTitle();
        
        // Auto-expand sidebar on mobile when content updates
        if (window.innerWidth <= 768 && this.expandSidebar) {
            // Brief delay to let content load, then expand
            setTimeout(() => {
                this.expandSidebar();
            }, 300);
        }
        
        const resultsContainer = document.getElementById('results-summary');
        const winnerInfo = document.getElementById('winner-info');
        
        switch (this.currentLevel) {
            case 'national':
                this.updateNationalSidebar(resultsContainer, winnerInfo);
                break;
            case 'state':
                this.updateStateSidebar(resultsContainer, winnerInfo);
                break;
            case 'statewide':
                this.updateStatewidesSidebar(resultsContainer, winnerInfo);
                break;
            case 'county':
                this.updateCountySidebar(resultsContainer, winnerInfo);
                break;
        }
    }

    getSidebarTitle() {
        switch (this.currentLevel) {
            case 'national':
                return `${this.currentYear} National Results`;
            case 'state':
                return `${this.currentYear} ${this.currentState} Results`;
            case 'statewide':
                return `${this.currentYear} ${this.currentState} Counties`;
            case 'county':
                const countyResult = this.countyResults.get(this.currentYear)?.get(this.currentCounty);
                return `${this.currentYear} ${countyResult?.name || 'County'} Results`;
        }
    }

    updateNationalSidebar(resultsContainer, winnerInfo) {
        const yearResults = this.stateResults.get(this.currentYear);
        if (!yearResults) {
            resultsContainer.innerHTML = '<p>No data available for this year.</p>';
            return;
        }
        
        const nationalVotes = new Map();
        const stateWins = new Map();
        
        yearResults.forEach(result => {
            Object.entries(result.votes).forEach(([party, votes]) => {
                const currentNationalVotes = nationalVotes.get(party) || 0;
                nationalVotes.set(party, currentNationalVotes + votes);
            });
            const currentStateWins = stateWins.get(result.winner) || 0;
            stateWins.set(result.winner, currentStateWins + 1);
        });
        
        const nationalWinner = this.determineWinner(nationalVotes);
        this.updateWinnerBanner(winnerInfo, nationalWinner, nationalVotes);
        
        const totalVotes = Array.from(nationalVotes.values()).reduce((a, b) => a + b, 0);
        
        // Sort parties by vote count (highest to lowest)
        const sortedParties = Array.from(nationalVotes.entries())
            .filter(([party, votes]) => votes > 0)
            .sort(([,a], [,b]) => b - a);

        let partyResults = '';
        sortedParties.forEach(([party, votes]) => {
            const statesWon = stateWins.get(party) || 0;
            const cssClass = this.getPartyCssClass(party);
            partyResults += `
                <div class="result-item ${cssClass}">
                    <div class="candidate-name">${this.getPartyName(party)}</div>
                    <div class="vote-info">
                        ${votes.toLocaleString()} votes 
                        (${((votes / totalVotes) * 100).toFixed(1)}%)
                    </div>
                    <div class="vote-info">${statesWon} states won</div>
                </div>
            `;
        });
        
        resultsContainer.innerHTML = partyResults + `
            <p style="margin-top: 1rem; opacity: 0.8; font-size: 0.9rem;">
                Click on any state to view state results.
            </p>
        `;
    }

    updateStateSidebar(resultsContainer, winnerInfo) {
        const stateResult = this.stateResults.get(this.currentYear)?.get(this.currentState);
        if (!stateResult) {
            resultsContainer.innerHTML = '<p>No data available for this state.</p>';
            return;
        }
        
        this.updateWinnerBanner(winnerInfo, stateResult.winner, stateResult.votes);
        
        const totalVotes = Object.values(stateResult.votes).reduce((a, b) => a + b, 0);
        
        // Sort parties by vote count (highest to lowest)
        const sortedParties = Object.entries(stateResult.votes)
            .filter(([party, votes]) => votes > 0)
            .sort(([,a], [,b]) => b - a);

        let partyResults = '';
        sortedParties.forEach(([party, votes]) => {
            partyResults += `
                <div class="result-item ${party.toLowerCase()}">
                    <div class="candidate-name">${this.getPartyName(party)}</div>
                    <div class="vote-info">
                        ${votes.toLocaleString()} votes 
                        (${((votes / totalVotes) * 100).toFixed(1)}%)
                    </div>
                </div>
            `;
        });
        
        resultsContainer.innerHTML = partyResults + `
            <p style="margin-top: 1rem; opacity: 0.8; font-size: 0.9rem;">
                Click on the state to view county-level breakdown.
            </p>
        `;
    }

    updateStatewidesSidebar(resultsContainer, winnerInfo) {
        const stateResult = this.stateResults.get(this.currentYear)?.get(this.currentState);
        if (!stateResult) {
            resultsContainer.innerHTML = '<p>No data available for this state.</p>';
            return;
        }
        
        this.updateWinnerBanner(winnerInfo, stateResult.winner, stateResult.votes);
        
        // Count county wins
        const countyWins = new Map();
        let totalCounties = 0;
        
        this.countyResults.get(this.currentYear)?.forEach((result, fips) => {
            if (result.state === this.currentState) {
                const currentWins = countyWins.get(result.winner) || 0;
                countyWins.set(result.winner, currentWins + 1);
                totalCounties++;
            }
        });
        
        // Special message for Alaska
        if (this.currentState === 'ALASKA' && totalCounties === 0) {
            resultsContainer.innerHTML = `
                <div style="padding: 1rem; background: #333; border-radius: 6px; margin-bottom: 1rem;">
                    <strong>Note:</strong> Alaska election data uses legislative districts, not the census areas/boroughs shown on the map. 
                    Geographic boundaries are displayed but no election data is available at this subdivision level.
                </div>
                <div>State winner: ${stateResult.winner}</div>
            `;
            return;
        }
        
        const totalVotes = Object.values(stateResult.votes).reduce((a, b) => a + b, 0);
        
        // Sort all parties by vote count
        const sortedParties = Object.entries(stateResult.votes)
            .filter(([party, votes]) => votes > 0)
            .sort(([,a], [,b]) => b - a);
            
        let partyResults = '';
        sortedParties.forEach(([party, votes]) => {
            const countiesWon = countyWins.get(party) || 0;
            const cssClass = this.getPartyCssClass(party);
            partyResults += `
                <div class="result-item ${cssClass}">
                    <div class="candidate-name">${this.getPartyName(party)}</div>
                    <div class="vote-info">
                        ${votes.toLocaleString()} votes 
                        (${((votes / totalVotes) * 100).toFixed(1)}%)
                    </div>
                    <div class="vote-info">${countiesWon} counties won</div>
                </div>
            `;
        });
        
        resultsContainer.innerHTML = partyResults + `
            <p style="margin-top: 1rem; opacity: 0.8; font-size: 0.9rem;">
                Click on any county to view detailed results.
            </p>
        `;
    }

    updateCountySidebar(resultsContainer, winnerInfo) {
        const countyResult = this.countyResults.get(this.currentYear)?.get(this.currentCounty);
        if (!countyResult) {
            resultsContainer.innerHTML = '<p>No data available for this county.</p>';
            return;
        }
        
        this.updateWinnerBanner(winnerInfo, countyResult.winner, countyResult.votes);
        
        const totalVotes = Object.values(countyResult.votes).reduce((a, b) => a + b, 0);
        
        // Get detailed candidate information
        let candidateInfo = '';
        const candidatesByParty = {};
        
        countyResult.candidates.forEach(candidate => {
            if (!candidatesByParty[candidate.party]) {
                candidatesByParty[candidate.party] = [];
            }
            candidatesByParty[candidate.party].push(candidate);
        });
        
        // Sort parties by vote count (highest to lowest)
        const sortedParties = Object.entries(candidatesByParty)
            .map(([party, candidates]) => ({
                party,
                candidates,
                votes: countyResult.votes[party]
            }))
            .filter(item => item.votes > 0)
            .sort((a, b) => b.votes - a.votes);

        sortedParties.forEach(({party, candidates, votes}) => {
            // Deduplicate candidate names (important for aggregated data like Rhode Island)
            const uniqueCandidates = [...new Set(candidates.map(c => c.candidate))];
            candidateInfo += `
                <div class="result-item ${party.toLowerCase()}">
                    <div class="candidate-name">${uniqueCandidates.join(', ')}</div>
                    <div class="vote-info">
                        ${votes.toLocaleString()} votes 
                        (${((votes / totalVotes) * 100).toFixed(1)}%)
                    </div>
                </div>
            `;
        });
        
        resultsContainer.innerHTML = candidateInfo + `
            <p style="margin-top: 1rem; opacity: 0.8; font-size: 0.9rem;">
                Total votes: ${totalVotes.toLocaleString()}
            </p>
        `;
    }

    updateWinnerBanner(winnerInfo, winner, votes) {
        const winnerBanner = winnerInfo.querySelector('.winner-banner');
        const winnerName = document.getElementById('winner-name');
        const winnerParty = document.getElementById('winner-party');
        
        const cssClass = this.getPartyCssClass(winner);
        winnerBanner.className = `winner-banner ${cssClass}`;
        winnerName.textContent = this.getPartyName(winner);
        
        // Handle both Map objects and regular objects
        const winnerVotes = votes instanceof Map ? votes.get(winner) : votes[winner];
        winnerParty.textContent = `${winnerVotes.toLocaleString()} votes`;
    }

    getPartyColor(party) {
        switch (party) {
            case 'REPUBLICAN': return '#DC143C';
            case 'DEMOCRAT': return '#4169E1';
            case 'LIBERTARIAN': return '#FED105'; // Libertarian Party official yellow
            default: return '#9370DB'; // Purple for other third parties
        }
    }

    getPartyName(party) {
        switch (party) {
            case 'REPUBLICAN': return 'Republican';
            case 'DEMOCRAT': return 'Democrat';
            // Handle common third parties with proper names
            case 'GREEN': return 'Green Party';
            case 'LIBERTARIAN': return 'Libertarian';
            case 'CONSTITUTION': return 'Constitution Party';
            case 'REFORM': return 'Reform Party';
            case 'INDEPENDENT': return 'Independent';
            default: 
                // Convert party name to title case for display
                return party.split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                ).join(' ');
        }
    }
    
    getPartyCssClass(party) {
        switch (party) {
            case 'REPUBLICAN': return 'republican';
            case 'DEMOCRAT': return 'democrat';
            case 'LIBERTARIAN': return 'libertarian';
            default: return 'other';
        }
    }

    // Cached FIPS matching to avoid repeated expensive lookups
    findCountyResult(topoId, state, year) {
        const cacheKey = `${year}-${state}-${topoId}`;
        
        if (this.fipsMatchCache.has(cacheKey)) {
            return this.fipsMatchCache.get(cacheKey);
        }
        
        const formats = [
            topoId,                           // "01009" - full 5-digit
            parseInt(topoId).toString(),      // "1009" - remove leading zero
            topoId.substring(2),              // "009" - county part only  
            parseInt(topoId.substring(2)).toString() // "9" - county without leading zeros
        ];
        
        let result = null;
        for (const format of formats) {
            result = this.countyResults.get(year)?.get(format);
            if (result && result.state === state) {
                break;
            }
        }
        
        // Cache the result (even if null) to avoid future lookups
        this.fipsMatchCache.set(cacheKey, result);
        return result;
    }

    getStateName(stateId) {
        const stateNames = {
            '01': 'ALABAMA', '02': 'ALASKA', '04': 'ARIZONA', '05': 'ARKANSAS',
            '06': 'CALIFORNIA', '08': 'COLORADO', '09': 'CONNECTICUT', '10': 'DELAWARE',
            '11': 'DISTRICT OF COLUMBIA', '12': 'FLORIDA', '13': 'GEORGIA', '15': 'HAWAII',
            '16': 'IDAHO', '17': 'ILLINOIS', '18': 'INDIANA', '19': 'IOWA',
            '20': 'KANSAS', '21': 'KENTUCKY', '22': 'LOUISIANA', '23': 'MAINE',
            '24': 'MARYLAND', '25': 'MASSACHUSETTS', '26': 'MICHIGAN', '27': 'MINNESOTA',
            '28': 'MISSISSIPPI', '29': 'MISSOURI', '30': 'MONTANA', '31': 'NEBRASKA',
            '32': 'NEVADA', '33': 'NEW HAMPSHIRE', '34': 'NEW JERSEY', '35': 'NEW MEXICO',
            '36': 'NEW YORK', '37': 'NORTH CAROLINA', '38': 'NORTH DAKOTA', '39': 'OHIO',
            '40': 'OKLAHOMA', '41': 'OREGON', '42': 'PENNSYLVANIA', '44': 'RHODE ISLAND',
            '45': 'SOUTH CAROLINA', '46': 'SOUTH DAKOTA', '47': 'TENNESSEE', '48': 'TEXAS',
            '49': 'UTAH', '50': 'VERMONT', '51': 'VIRGINIA', '53': 'WASHINGTON',
            '54': 'WEST VIRGINIA', '55': 'WISCONSIN', '56': 'WYOMING'
        };
        
        return stateNames[stateId.toString().padStart(2, '0')] || 'UNKNOWN';
    }

    getStateNameFromFips(fipsCode) {
        return this.getStateName(fipsCode);
    }

    showStateTooltip(event, stateName, result) {
        if (!result) return;
        
        const totalVotes = Object.values(result.votes).reduce((a, b) => a + b, 0);
        const winnerVotes = result.votes[result.winner];
        const percentage = ((winnerVotes / totalVotes) * 100).toFixed(1);
        
        this.tooltip.transition()
            .duration(200)
            .style('opacity', .9);
            
        this.tooltip.html(`
            <strong>${stateName}</strong><br/>
            Winner: ${this.getPartyName(result.winner)}<br/>
            Votes: ${winnerVotes.toLocaleString()} (${percentage}%)
        `)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    }

    showCountyTooltip(event, result) {
        if (!result) return;
        
        const totalVotes = Object.values(result.votes).reduce((a, b) => a + b, 0);
        const winnerVotes = result.votes[result.winner];
        const percentage = ((winnerVotes / totalVotes) * 100).toFixed(1);
        
        // Use the same tooltip method for consistency and performance
        this.showTooltip(event, `
            <strong>${result.name}</strong><br/>
            Winner: ${this.getPartyName(result.winner)}<br/>
            Votes: ${winnerVotes.toLocaleString()} (${percentage}%)
        `);
    }

    hideTooltip() {
        this.tooltip.transition()
            .duration(500)
            .style('opacity', 0);
    }

    handleResize() {
        const container = document.getElementById('map-container');
        const rect = container.getBoundingClientRect();
        
        this.svg
            .attr('width', rect.width)
            .attr('height', rect.height);
            
        this.projection
            .scale(Math.min(rect.width, rect.height) * 1.0)
            .translate([rect.width / 2, rect.height / 2]);
            
        this.updateCurrentView();
    }

    showError(message) {
        document.getElementById('results-summary').innerHTML = 
            `<p style="color: #ff6b6b;">${message}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const electionMap = new ElectionMap();
    
    // Expose cache clearing for debugging
    window.clearElectionCaches = () => {
        electionMap.clearPerformanceCaches();
        location.reload(); // Force full refresh
    };
    
    // Expose map instance for debugging
    window.electionMap = electionMap;
});