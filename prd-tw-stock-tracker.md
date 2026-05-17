# Product Requirements Document: Taiwan Stock Price Tracker Dashboard

## Problem Statement
The user needs a specialized, personal dashboard to track up to 100 Taiwan stock prices and receive highly visible visual alerts when prices approach custom target levels. Current generic stock tools lack the customized "breathing light" alert effect and the specific 1920x1080 full-screen dashboard aesthetic required for a dedicated monitoring station. Additionally, direct browser-based solutions suffer from CORS limitations when accessing free APIs like Yahoo Finance.

## Solution
Develop a custom, full-screen (1920x1080) web-based dashboard consisting of a lightweight local Node.js proxy server and a visually striking frontend. The frontend will display up to 100 stocks in a 10x10 grid of cards. It will utilize LocalStorage for persistence, ensuring user configurations (tickers, buy/sell prices) are saved. The system will periodically fetch real-time data via the proxy to avoid API blocks, and employ a global sensitivity slider to trigger a prominent CSS "breathing light" effect when prices near or breach the user's targets.

## User Stories
1. As a user, I want to input a Taiwan stock ticker (e.g., 2330.TW), so that I can add it to my monitoring dashboard.
2. As a user, I want to add up to 100 distinct stock tickers, so that I can monitor my entire watchlist simultaneously.
3. As a user, I want my stock list and target settings to be saved automatically, so that I don't lose them when I close or refresh the browser.
4. As a user, I want to set a specific "Buy Price" and "Sell Price" for each stock card, so that the system knows my trading goals.
5. As a user, I want to see all my tracked stocks in a highly visual 10x10 card grid layout filling a 1080p screen, so that I get a professional "war room" monitoring experience.
6. As a user, I want to adjust a global "Alert Sensitivity" slider (e.g., 0.05% to 2.0%), so that I can change how early the dashboard warns me based on market volatility.
7. As a user, I want a stock's card to flash a "breathing light" effect when its current price is within the alert sensitivity percentage of my target, so that it catches my eye immediately.
8. As a user, I want the card's alert light to change color and flash intensely if the price actually breaches (crosses) my target price, so that I know the target has been hit.
9. As a user, I want the system to automatically fetch data every 60 seconds (batch update) by default, so that I get near real-time updates without being blocked by Yahoo Finance.
10. As a user, I want a manual "Refresh" button and an auto-refresh toggle, so that I have complete control over when data is pulled.
11. As a user, I want the option to sort the cards on the dashboard (e.g., by % change), so that I can analyze the day's strongest or weakest stocks at a glance.

## Implementation Decisions

Based on the `/grill-me` discussion, the system will be split into the following major modules:

1. **Yahoo Finance Proxy Service (Backend)**: 
   - A minimalist Node.js server (e.g., Express or Fastify).
   - Exposes a single endpoint that accepts an array of tickers.
   - Fetches batch data from Yahoo Finance API to avoid rate limiting and bypasses browser CORS restrictions.
2. **Stock State Manager (Frontend)**: 
   - A module dedicated to interacting with `LocalStorage`.
   - Handles the schema for storing `[ { ticker, buyTarget, sellTarget, ... } ]`.
3. **Alert Evaluator Engine (Frontend)**: 
   - A pure, testable function module.
   - Inputs: `currentPrice`, `buyTarget`, `sellTarget`, `globalThresholdPercentage`.
   - Output: `status` ('normal', 'nearing-buy', 'nearing-sell', 'breached-buy', 'breached-sell').
4. **Dashboard UI Component (Frontend)**: 
   - Uses Vite + Vanilla JS/CSS (or lightweight framework) for high performance.
   - Implements the CSS animations for the breathing lights and grid layout.

*Architectural Decision*: Data persistence is strictly client-side (LocalStorage) to keep the system stateless and maintenance-free. API fetching must route through the local proxy.

## Testing Decisions

To ensure the alerts are mathematically accurate, we should implement unit tests for specific modules. 

- **Modules to be tested**: The **Alert Evaluator Engine**.
- **What makes a good test**: We will test pure external behavior. We will feed the evaluator various scenarios (e.g., price exactly at target, price 0.01% away, price 2% away) and assert that it returns the correct status.
- UI and Proxy Server testing will be largely manual or out of scope for the initial build, focusing testing efforts purely on the alert math logic.

## Out of Scope
- A centralized database (e.g., MySQL, PostgreSQL, Firebase) for multi-user synchronization.
- Complex charting or candlestick visualization (the focus is on current price vs target).
- Executing actual trades via broker APIs.
- Real-time WebSocket streaming (using batch polling instead).

## Further Notes
- The 0.05% threshold is extremely tight for Taiwanese stocks. The inclusion of the Global Slider will be critical for usability.
- We will need to ensure the CSS animations are hardware-accelerated (`transform`, `opacity`) so that 100 flashing cards do not cause browser lag.
