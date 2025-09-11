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
        this.tooltip = null;
        this.zoom = null;
        
        // Performance optimization: cache and lazy loading
        this.processedYears = new Set();
        this.rawCsvData = null;
        this.renderCache = new Map();
        this.debounceTimeout = null;
        this.navigationTimeout = null;
        this.fipsMatchCache = new Map(); // Cache FIPS format matching results
        
        this.init();
    }

    async init() {
        this.setupSVG();
        this.createTooltip();
        this.setupEventListeners();
        
        try {
            await this.loadTopology();
            await this.loadElectionData();
            this.renderNationalView();
            this.updateSidebar();
            this.updateBreadcrumb();
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
            .scale(Math.min(rect.width, rect.height) * 0.8)
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
        
        // Breadcrumb navigation
        document.getElementById('breadcrumb-national').addEventListener('click', () => {
            this.navigateToNational();
        });
        
        document.getElementById('breadcrumb-state').addEventListener('click', () => {
            if (this.currentState) {
                this.navigateToState(this.currentState);
            }
        });
        
        document.getElementById('breadcrumb-statewide').addEventListener('click', () => {
            if (this.currentState) {
                this.navigateToStatewide(this.currentState);
            }
        });
        
        // Drill-up button
        document.getElementById('drillUpButton').addEventListener('click', () => {
            this.drillUp();
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
            return 'OTHER';
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
                const stateVotes = { REPUBLICAN: 0, DEMOCRAT: 0, OTHER: 0 };
                
                stateData.forEach((countyData, countyFips) => {
                    const countyVotes = { REPUBLICAN: 0, DEMOCRAT: 0, OTHER: 0 };
                    let countyName = 'Unknown County';
                    
                    countyData.forEach(candidate => {
                        countyVotes[candidate.party] += candidate.votes;
                        stateVotes[candidate.party] += candidate.votes;
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
                    
                    this.countyResults.get(year).set(storageKey, {
                        winner: countyWinner,
                        votes: countyVotes,
                        state: stateName,
                        name: countyName,
                        candidates: countyData
                    });
                });
                
                const stateWinner = this.determineWinner(stateVotes);
                this.stateResults.get(year).set(stateName, {
                    winner: stateWinner,
                    votes: stateVotes
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
        let winner = 'OTHER';
        
        Object.entries(votes).forEach(([party, voteCount]) => {
            if (voteCount > maxVotes) {
                maxVotes = voteCount;
                winner = party;
            }
        });
        
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

    navigateToStatewide(stateName) {
        if (this.currentLevel === 'statewide' && this.currentState === stateName) return;
        
        this.currentLevel = 'statewide';
        this.currentState = stateName;
        this.currentCounty = null;
        this.performNavigation();
    }

    navigateToCounty(stateName, countyFips) {
        if (this.currentLevel === 'county' && this.currentState === stateName && this.currentCounty === countyFips) return;
        
        this.currentLevel = 'county';
        this.currentState = stateName;
        this.currentCounty = countyFips;
        this.performNavigation();
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

    drillUp() {
        switch (this.currentLevel) {
            case 'county':
                // County > State-wide
                this.navigateToStatewide(this.currentState);
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
            .on('click', () => {
                this.navigateToStatewide(this.currentState);
            });
    }

    renderStatewideView() {
        this.g.selectAll('*').remove();
        
        // Get counties/districts/boroughs for this state using the working MagicWall approach
        // Filter by state FIPS from county properties, not by county FIPS matching
        const stateCounties = topojson.feature(this.countiesTopology, this.countiesTopology.objects.counties).features
            .filter(d => {
                // Use the state FIPS from the county's properties to filter by state
                const stateFips = Math.floor(d.id / 1000).toString().padStart(2, '0'); // Extract state FIPS from county FIPS
                const featureStateName = this.getStateNameFromFips(stateFips);
                return featureStateName && featureStateName === this.currentState;
            });
        
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
        
        // Draw counties
        this.g.selectAll('.county')
            .data(stateCounties)
            .enter().append('path')
            .attr('class', 'county')
            .attr('d', this.path)
            .attr('fill', d => {
                // TopoJSON gives us full 5-digit FIPS like "01009"
                // Our data might be stored as 4-digit like "1009" 
                // Try multiple formats to find the match
                
                const topoId = d.id.toString(); // e.g. "01009"
                
                // Try various FIPS formats
                const formats = [
                    topoId,                           // "01009" - full 5-digit
                    parseInt(topoId).toString(),      // "1009" - remove leading zero
                    topoId.substring(2),              // "009" - county part only  
                    parseInt(topoId.substring(2)).toString() // "9" - county without leading zeros
                ];
                
                let result = null;
                for (const format of formats) {
                    result = this.countyResults.get(this.currentYear)?.get(format);
                    if (result && result.state === this.currentState) {
                        break;
                    }
                }
                
                // Enhanced debug for problematic states  
                if (['ALABAMA', 'RHODE ISLAND', 'ALASKA'].includes(this.currentState)) {
                    if (!result) {
                        console.log(`${this.currentState} county ${topoId}: tried formats [${formats.join(', ')}], no match found`);
                        if (!this[`debugged_data_${this.currentState}`]) {
                            this[`debugged_data_${this.currentState}`] = true;
                            const stateKeys = Array.from(this.countyResults.get(this.currentYear).keys())
                                .filter(key => {
                                    const countyResult = this.countyResults.get(this.currentYear).get(key);
                                    return countyResult && countyResult.state === this.currentState;
                                });
                            console.log(`${this.currentState} available FIPS codes (${stateKeys.length} total):`, stateKeys.slice(0, 10));
                            console.log(`${this.currentState} first few county topo IDs:`, stateCounties.slice(0, 5).map(d => d.id));
                            
                            // Show specific examples of mismatches
                            if (this.currentState === 'ALABAMA') {
                                const firstTopoId = stateCounties[0]?.id;
                                if (firstTopoId) {
                                    console.log(`Alabama sample: topo=${firstTopoId}, checking data for keys: ${formats.join(', ')}`);
                                    formats.forEach(format => {
                                        const testResult = this.countyResults.get(this.currentYear)?.get(format);
                                        console.log(`  ${format}: ${testResult ? `found (${testResult.state})` : 'not found'}`);
                                    });
                                }
                            }
                        }
                    }
                }
                
                return result ? this.getPartyColor(result.winner) : '#666';
            })
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.15)
            .on('click', (event, d) => {
                // Find the FIPS format that exists in our data (same logic as coloring)
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                let countyFips = null;
                for (const format of formats) {
                    const result = this.countyResults.get(this.currentYear)?.get(format);
                    if (result && result.state === this.currentState) {
                        countyFips = format;
                        break;
                    }
                }
                
                // For Alaska, also check if this TopoJSON ID matches a mapped borough
                if (!countyFips && this.currentState === 'ALASKA') {
                    const result = this.countyResults.get(this.currentYear)?.get(topoId);
                    if (result && result.state === this.currentState) {
                        countyFips = topoId;
                    }
                }
                
                if (countyFips) {
                    this.navigateToCounty(this.currentState, countyFips);
                } else {
                    console.warn(`No county data found for ${topoId} in ${this.currentState}`);
                }
            })
            .on('mouseover', (event, d) => {
                const fips4 = d.id.toString();
                const fips5 = d.id.toString().padStart(5, '0');
                const result = this.countyResults.get(this.currentYear)?.get(fips4) || 
                              this.countyResults.get(this.currentYear)?.get(fips5);
                this.showCountyTooltip(event, result);
            })
            .on('mouseout', () => {
                this.hideTooltip();
            });
    }

    renderCountyView() {
        this.g.selectAll('*').remove();
        
        // Get all counties in the current state for context
        const stateCounties = topojson.feature(this.countiesTopology, this.countiesTopology.objects.counties).features
            .filter(d => {
                const stateFips = Math.floor(d.id / 1000).toString().padStart(2, '0');
                const featureStateName = this.getStateNameFromFips(stateFips);
                return featureStateName && featureStateName === this.currentState;
            });
        
        // Debug current county selection
        if (this.currentState === 'ALABAMA') {
            console.log('Alabama county view debug:', {
                currentState: this.currentState,
                currentCounty: this.currentCounty,
                currentCountyType: typeof this.currentCounty,
                stateCountiesCount: stateCounties.length,
                firstFewCountyIds: stateCounties.slice(0, 3).map(d => d.id)
            });
        }
        
        // Find the specific selected county
        let selectedCountyFeature = null;
        for (const county of stateCounties) {
            const topoId = county.id.toString();
            const formats = [
                topoId,                           // "01009" - full 5-digit
                parseInt(topoId).toString(),      // "1009" - remove leading zero
                topoId.substring(2),              // "009" - county part only  
                parseInt(topoId.substring(2)).toString() // "9" - county without leading zeros
            ];
            
            if (formats.includes(this.currentCounty)) {
                selectedCountyFeature = county;
                if (this.currentState === 'ALABAMA') {
                    console.log(`Alabama: Found selected county ${topoId} matching ${this.currentCounty}`);
                }
                break;
            }
        }
            
        if (!selectedCountyFeature) {
            console.error(`County view: could not find county feature for FIPS ${this.currentCounty}`);
            return;
        }
        
        // Zoom to the selected county
        const bounds = this.path.bounds(selectedCountyFeature);
        this.zoomToBounds(bounds, 0.6); // More padding for county detail
        
        // Draw all counties in the state
        this.g.selectAll('.county')
            .data(stateCounties)
            .enter().append('path')
            .attr('class', 'county')
            .attr('d', this.path)
            .attr('fill', d => {
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                let result = null;
                for (const format of formats) {
                    result = this.countyResults.get(this.currentYear)?.get(format);
                    if (result && result.state === this.currentState) {
                        break;
                    }
                }
                
                return result ? this.getPartyColor(result.winner) : '#666';
            })
            .attr('stroke', d => {
                // Highlight selected county with glowing white border
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                return formats.includes(this.currentCounty) ? '#ffffff' : '#ffffff';
            })
            .attr('stroke-width', d => {
                // Thicker, glowing border for selected county
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                const isSelected = formats.includes(this.currentCounty);
                
                // Debug stroke-width for Alabama
                if (this.currentState === 'ALABAMA' && isSelected) {
                    console.log(`Alabama stroke debug - County ${topoId}: will have thick border (2px)`);
                }
                
                return isSelected ? 2 : 0.15;
            })
            .style('filter', d => {
                // Add very subtle floating effect to selected county
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                const isSelected = formats.includes(this.currentCounty);
                
                // Debug for Alabama glow issues
                if (this.currentState === 'ALABAMA' && (isSelected || formats[0] === this.currentCounty)) {
                    console.log(`Alabama glow debug - County ${topoId}:`, {
                        formats: formats,
                        currentCounty: this.currentCounty,
                        isSelected: isSelected,
                        willGlow: isSelected
                    });
                }
                
                return isSelected ? 
                    'drop-shadow(0 0 8px rgba(255,255,255,1)) drop-shadow(0 0 16px rgba(255,255,255,0.6)) drop-shadow(0 2px 6px rgba(0,0,0,0.3))' : 
                    'none';
            })
            .style('transform', d => {
                // Very subtle floating lift
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                return formats.includes(this.currentCounty) ? 'translate(0, -0.1px)' : 'none';
            })
            .style('transform-origin', 'center')
            .on('click', (event, d) => {
                // Enable county-to-county navigation in county view
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                let newCountyFips = null;
                for (const format of formats) {
                    const result = this.countyResults.get(this.currentYear)?.get(format);
                    if (result && result.state === this.currentState) {
                        newCountyFips = format;
                        break;
                    }
                }
                
                // Navigate to the clicked county (stay in county view, just change selection)
                if (newCountyFips && newCountyFips !== this.currentCounty) {
                    this.navigateToCounty(this.currentState, newCountyFips);
                }
            })
            .on('mouseover', (event, d) => {
                const topoId = d.id.toString();
                const formats = [
                    topoId,                           
                    parseInt(topoId).toString(),      
                    topoId.substring(2),              
                    parseInt(topoId.substring(2)).toString()
                ];
                
                let result = null;
                for (const format of formats) {
                    result = this.countyResults.get(this.currentYear)?.get(format);
                    if (result && result.state === this.currentState) {
                        break;
                    }
                }
                
                if (result) {
                    this.showTooltip(event, `${result.name}<br/>${result.winner}: ${result.votes[result.winner].toLocaleString()} votes`);
                }
            })
            .on('mouseleave', () => {
                this.hideTooltip();
            });
    }

    zoomToBounds(bounds, paddingFactor = 0.8) {
        const [[x0, y0], [x1, y1]] = bounds;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const x = (x0 + x1) / 2;
        const y = (y0 + y1) / 2;
        
        const container = document.getElementById('map-container');
        const rect = container.getBoundingClientRect();
        
        const scale = Math.min(rect.width / dx, rect.height / dy) * paddingFactor;
        const translate = [rect.width / 2 - scale * x, rect.height / 2 - scale * y];
        
        this.svg.transition()
            .duration(750)
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

    showTooltip(event, content) {
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
                .style('opacity', 0);
        }

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
        // Debounce rapid view changes and use requestAnimationFrame for smooth rendering
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
        }, 50); // 50ms debounce
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
        
        const nationalVotes = { REPUBLICAN: 0, DEMOCRAT: 0, OTHER: 0 };
        const stateWins = { REPUBLICAN: 0, DEMOCRAT: 0, OTHER: 0 };
        
        yearResults.forEach(result => {
            Object.entries(result.votes).forEach(([party, votes]) => {
                nationalVotes[party] += votes;
            });
            stateWins[result.winner]++;
        });
        
        const nationalWinner = this.determineWinner(nationalVotes);
        this.updateWinnerBanner(winnerInfo, nationalWinner, nationalVotes);
        
        const totalVotes = Object.values(nationalVotes).reduce((a, b) => a + b, 0);
        
        // Sort parties by vote count (highest to lowest)
        const sortedParties = Object.entries(nationalVotes)
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
                    <div class="vote-info">${stateWins[party]} states won</div>
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
        const countyWins = { REPUBLICAN: 0, DEMOCRAT: 0, OTHER: 0 };
        let totalCounties = 0;
        
        this.countyResults.get(this.currentYear)?.forEach((result, fips) => {
            if (result.state === this.currentState) {
                countyWins[result.winner]++;
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
        
        resultsContainer.innerHTML = `
            <div class="result-item ${stateResult.winner.toLowerCase()}">
                <div class="candidate-name">${this.getPartyName(stateResult.winner)}</div>
                <div class="vote-info">
                    ${stateResult.votes[stateResult.winner].toLocaleString()} votes 
                    (${((stateResult.votes[stateResult.winner] / totalVotes) * 100).toFixed(1)}%)
                </div>
                <div class="vote-info">${countyWins[stateResult.winner]} counties won</div>
            </div>
            <div class="result-item ${stateResult.winner === 'REPUBLICAN' ? 'democrat' : 'republican'}">
                <div class="candidate-name">${this.getPartyName(stateResult.winner === 'REPUBLICAN' ? 'DEMOCRAT' : 'REPUBLICAN')}</div>
                <div class="vote-info">
                    ${stateResult.votes[stateResult.winner === 'REPUBLICAN' ? 'DEMOCRAT' : 'REPUBLICAN'].toLocaleString()} votes 
                    (${((stateResult.votes[stateResult.winner === 'REPUBLICAN' ? 'DEMOCRAT' : 'REPUBLICAN'] / totalVotes) * 100).toFixed(1)}%)
                </div>
                <div class="vote-info">${countyWins[stateResult.winner === 'REPUBLICAN' ? 'DEMOCRAT' : 'REPUBLICAN']} counties won</div>
            </div>
            ${stateResult.votes.OTHER > 0 ? `
            <div class="result-item other">
                <div class="candidate-name">Other/Third Party</div>
                <div class="vote-info">
                    ${stateResult.votes.OTHER.toLocaleString()} votes 
                    (${((stateResult.votes.OTHER / totalVotes) * 100).toFixed(1)}%)
                </div>
                <div class="vote-info">${countyWins.OTHER} counties won</div>
            </div>` : ''}
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
        
        winnerBanner.className = `winner-banner ${winner.toLowerCase()}`;
        winnerName.textContent = this.getPartyName(winner);
        winnerParty.textContent = `${votes[winner].toLocaleString()} votes`;
    }

    getPartyColor(party) {
        switch (party) {
            case 'REPUBLICAN': return '#DC143C';
            case 'DEMOCRAT': return '#4169E1';
            default: return '#9370DB';
        }
    }

    getPartyName(party) {
        switch (party) {
            case 'REPUBLICAN': return 'Republican';
            case 'DEMOCRAT': return 'Democrat';
            default: return 'Other/Third Party';
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
        
        this.tooltip.transition()
            .duration(200)
            .style('opacity', .9);
            
        this.tooltip.html(`
            <strong>${result.name}</strong><br/>
            Winner: ${this.getPartyName(result.winner)}<br/>
            Votes: ${winnerVotes.toLocaleString()} (${percentage}%)
        `)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
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
            .scale(Math.min(rect.width, rect.height) * 0.8)
            .translate([rect.width / 2, rect.height / 2]);
            
        this.updateCurrentView();
    }

    showError(message) {
        document.getElementById('results-summary').innerHTML = 
            `<p style="color: #ff6b6b;">${message}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ElectionMap();
});