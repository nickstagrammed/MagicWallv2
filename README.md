# Election Magic Wall v2

Interactive presidential election results mapping application with drill-down navigation and historical data analysis.

## Overview

The Election Magic Wall is a D3.js-powered web application that visualizes U.S. presidential election results from 2000-2024 with multi-level drill-down navigation. Users can explore results from national level down to individual counties with smooth transitions and detailed vote breakdowns.

## Features

### 🗺️ Multi-Level Navigation
- **National View**: Complete U.S. map with state-by-state results
- **State View**: Individual state focus with winner highlighting
- **State-wide View**: All counties within a state visible
- **County View**: Zoomed county detail with neighboring context

### 📊 Interactive Data Exploration
- **Year Selection**: Browse presidential elections from 2000-2024
- **Drill-down Navigation**: Click states/counties to zoom deeper
- **Drill-up Navigation**: Breadcrumb navigation and dedicated drill-up button
- **County-to-County Navigation**: Direct navigation between adjacent counties

### 🎨 Visual Design
- **Traditional Election Colors**: Republican red (#DC143C), Democrat blue (#4169E1), Other purple (#9370DB)
- **Refined Borders**: Thin white borders with smart hover effects
- **Glowing Selection**: Selected counties highlighted with multi-layer glow effect
- **Floating Animation**: Subtle elevation effect for selected counties
- **Responsive Design**: Mobile-friendly layout with adaptive controls

### ⚡ Performance Features
- **Lazy Loading**: Data processed on-demand by year
- **Smart Caching**: FIPS matching results cached for instant navigation
- **Smooth Animations**: 60fps transitions with requestAnimationFrame
- **Debounced Rendering**: Optimized DOM updates prevent stuttering

## Technical Architecture

### Data Processing
- **Multi-mode Handling**: Sophisticated logic handles different voting modes across years
- **Double-counting Prevention**: Smart aggregation avoids "TOTAL VOTES" vs component mode conflicts
- **State-specific Logic**: Custom handling for unique data formats (Rhode Island cities, Alaska districts)
- **FIPS Mapping**: Flexible format matching between TopoJSON and election data

### Special State Handling
- **Alaska**: District-based election data mapped to geographic boroughs
- **Rhode Island**: City/town data aggregated to county level
- **Historical Compatibility**: Mode resolution works across all election years

### Geographic Data
- **TopoJSON Sources**: 
  - States: `us-atlas@3/states-10m.json`
  - Counties: `us-atlas@3/counties-10m.json`
- **Projection**: D3.js geoAlbersUsa (optimized for U.S. maps)
- **Election Data**: County-level presidential results CSV (2000-2024)

## File Structure

```
MagicWallv2/
├── index.html              # Main application HTML
├── styles.css              # Responsive styling and animations
├── election-map.js          # Core application logic
├── data/
│   └── countypres_2000-2024.csv    # Historical election data
└── README.md               # This documentation
```

## Key Components

### ElectionMap Class
Main application controller managing:
- Data loading and processing
- Navigation state management  
- Rendering and animations
- User interaction handling

### Navigation Methods
- `navigateToNational()` - Return to national overview
- `navigateToState(stateName)` - Focus on specific state
- `navigateToStatewide(stateName)` - Show state's counties
- `navigateToCounty(stateName, countyFips)` - Zoom to county detail

### Performance Optimizations
- `processYearData()` - Lazy load election data by year
- `findCountyResult()` - Cached FIPS format matching
- `performNavigation()` - Batched DOM updates
- `updateCurrentView()` - Debounced rendering

## Data Sources

- **Election Data**: MIT Election Data + Science Lab county presidential returns
- **Geographic Boundaries**: U.S. Atlas TopoJSON (Mike Bostock)
- **Years Covered**: 2000, 2004, 2008, 2012, 2016, 2020, 2024

## Browser Support

- Modern browsers with ES6+ support
- Chrome 60+, Firefox 60+, Safari 12+, Edge 79+
- Mobile browsers with touch support

## Installation & Usage

1. **Local Server**: Start HTTP server in project directory
   ```bash
   python -m http.server 8080
   ```

2. **Access**: Navigate to `http://localhost:8080`

3. **Navigate**: 
   - Select year from dropdown
   - Click states/counties to drill down
   - Use breadcrumb navigation or drill-up button (↺) to navigate back
   - Hover for vote count tooltips

## Development

### Performance Considerations
- Data processing is lazy-loaded by year for faster initial load
- FIPS matching results are cached to prevent repeated expensive lookups
- DOM updates are batched and debounced for smooth animations
- Navigation prevents duplicate calls to avoid performance degradation

### Extensibility
- Modular design allows easy addition of new visualization modes
- Cached data architecture supports additional data sources
- Flexible FIPS matching handles various data format inconsistencies

## Known Limitations

- Alaska uses legislative districts in election data vs geographic boroughs in map boundaries
- Some historical years may have incomplete county-level data
- Performance scales with dataset size (94K+ records total)

## Future Enhancements

- Additional election types (Senate, Governor, House)
- Demographic overlay data integration
- Export functionality for maps and data
- Advanced filtering and comparison tools

## License

This project is for educational and research purposes. Election data courtesy of MIT Election Data + Science Lab.