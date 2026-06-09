const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory cache to prevent hitting rate limits
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours cache

// Helper to fetch additional GitHub stats safely with Promise.allSettled
async function fetchGithubStats(username) {
  const stats = {
    followers: 0,
    publicRepos: 0,
    totalPrsAccepted: 0,
    topRepo: { name: 'None', stars: 0, forks: 0 }
  };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const [userRes, reposRes, prsRes] = await Promise.allSettled([
      axios.get(`https://api.github.com/users/${username}`, { headers, timeout: 5000 }),
      axios.get(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, { headers, timeout: 5000 }),
      axios.get(`https://api.github.com/search/issues?q=author:${username}+type:pr+is:merged`, { headers, timeout: 5000 })
    ]);

    if (userRes.status === 'fulfilled' && userRes.value.data) {
      stats.followers = userRes.value.data.followers || 0;
      stats.publicRepos = userRes.value.data.public_repos || 0;
    }

    if (reposRes.status === 'fulfilled' && Array.isArray(reposRes.value.data)) {
      const repos = reposRes.value.data;
      if (repos.length > 0) {
        // Find repo with highest stargazers_count
        let topRepo = repos[0];
        repos.forEach(repo => {
          if (repo.stargazers_count > topRepo.stargazers_count) {
            topRepo = repo;
          }
        });
        
        stats.topRepo = {
          name: topRepo.name,
          stars: topRepo.stargazers_count,
          forks: topRepo.forks_count
        };
      }
    }

    if (prsRes.status === 'fulfilled' && prsRes.value.data) {
      stats.totalPrsAccepted = prsRes.value.data.total_count || 0;
    }
  } catch (err) {
    console.error(`[Error] Failed to fetch some GitHub stats for ${username}: ${err.message}`);
  }

  return stats;
}

// Shared helper to retrieve contributions (with caching & fallback scraping)
async function getContributionsData(username) {
  // Check cache first
  const cachedData = cache.get(username);
  if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
    console.log(`[Cache Hit] Serving data for user: ${username}`);
    return cachedData.data;
  }

  console.log(`[API Fetch] Fetching contribution data & stats for user: ${username}`);
  
  try {
    // Fetch contribution data and profile stats in parallel
    const [contribRes, githubStats] = await Promise.all([
      axios.get(`https://github-contributions-api.jogruber.de/v4/${username}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000 // 10s timeout
      }),
      fetchGithubStats(username)
    ]);

    if (contribRes.data && contribRes.data.contributions) {
      const mergedData = {
        total: contribRes.data.total,
        contributions: contribRes.data.contributions,
        githubStats
      };

      // Save to cache
      cache.set(username, {
        timestamp: Date.now(),
        data: mergedData
      });
      return mergedData;
    } else {
      throw new Error('Invalid data format received from upstream API');
    }
  } catch (error) {
    console.error(`[Error] Failed to fetch from primary API: ${error.message}`);
    
    // Attempt Fallback: Fetch directly from GitHub's contributions graph HTML snippet
    try {
      console.log(`[Fallback Fetch] Scrapes graph and stats for: ${username}`);
      const githubUrl = `https://github.com/users/${username}/contributions`;
      
      const [response, githubStats] = await Promise.all([
        axios.get(githubUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 10000
        }),
        fetchGithubStats(username)
      ]);
      
      const html = response.data;
      const contributions = [];
      const totalByYear = {};
      
      const dayRegex = /(?:<rect|<td)[^>]*class="[^"]*ContributionCalendar-day[^"]*"[^>]*data-date="([^"]+)"[^>]*data-level="([^"]+)"/g;
      
      const tooltips = {};
      const tooltipRegex = /<tool-tip\s+for="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g;
      let m;
      while ((m = tooltipRegex.exec(html)) !== null) {
        tooltips[m[1]] = m[2].trim();
      }

      let dayMatch;
      const elementIdRegex = /id="([^"]+)"/;
      const countRegex = /(No|\d+)\s+contribution/;

      while ((dayMatch = dayRegex.exec(html)) !== null) {
        const fullTag = dayMatch[0];
        const date = dayMatch[1];
        const level = parseInt(dayMatch[2], 10);
        
        let count = 0;
        const idMatch = elementIdRegex.exec(fullTag);
        if (idMatch && tooltips[idMatch[1]]) {
          const text = tooltips[idMatch[1]];
          const cMatch = countRegex.exec(text);
          if (cMatch) {
            count = cMatch[1] === 'No' ? 0 : parseInt(cMatch[1], 10);
          }
        } else {
          count = level === 0 ? 0 : level === 1 ? 1 : level === 2 ? 3 : level === 3 ? 6 : 10;
        }

        contributions.push({ date, count, level });
        
        const year = date.split('-')[0];
        totalByYear[year] = (totalByYear[year] || 0) + count;
      }

      if (contributions.length > 0) {
        contributions.sort((a, b) => new Date(a.date) - new Date(b.date));

        const scrapedData = {
          total: totalByYear,
          contributions: contributions,
          githubStats
        };

        cache.set(username, {
          timestamp: Date.now(),
          data: scrapedData
        });

        console.log(`[Fallback Success] Scraped ${contributions.length} contributions & stats for ${username}`);
        return scrapedData;
      } else {
        throw new Error('Failed to parse contribution cells from GitHub HTML');
      }
    } catch (fallbackError) {
      console.error(`[Error] Fallback scraping also failed: ${fallbackError.message}`);
      throw fallbackError;
    }
  }
}

// Proxy endpoint to fetch contribution data and stats
app.get('/api/contributions/:username', async (req, res) => {
  const { username } = req.params;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const data = await getContributionsData(username);
    // Set 24 hour client & Edge CDN caching
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
    return res.json(data);
  } catch (error) {
    console.error(`[Error] API endpoint failed: ${error.message}`);
    return res.status(500).json({ 
      error: `Could not retrieve contribution data for ${username}`, 
      details: error.message 
    });
  }
});

// SVG Badge generator themes
const themes = {
  green: {
    level0: '#161b22', level1: '#0e4429', level2: '#006d32', level3: '#26a641', level4: '#39d353',
    text: '#8b949e', accent: '#39d353', bg: '#0d1117'
  },
  purple: {
    level0: '#161b22', level1: '#2d124d', level2: '#561e99', level3: '#8a2be2', level4: '#b026ff',
    text: '#8b949e', accent: '#b026ff', bg: '#0d1117'
  },
  orange: {
    level0: '#161b22', level1: '#4a1d07', level2: '#8a3307', level3: '#d9540b', level4: '#ff7b26',
    text: '#8b949e', accent: '#ff7b26', bg: '#0d1117'
  },
  blue: {
    level0: '#161b22', level1: '#06263e', level2: '#054874', level3: '#0c7eb0', level4: '#00bfff',
    text: '#8b949e', accent: '#00bfff', bg: '#0d1117'
  },
  mono: {
    level0: '#161b22', level1: '#30363d', level2: '#6e7681', level3: '#afb8c1', level4: '#f0f6fc',
    text: '#8b949e', accent: '#f0f6fc', bg: '#0d1117'
  },
  glass: {
    level0: '#12161a', level1: '#3a3a3a', level2: '#707070', level3: '#b0b0b0', level4: '#ffffff',
    text: '#b0b0b0', accent: '#ffffff', bg: '#030508'
  },
  white: {
    level0: '#161b22', level1: '#30363d', level2: '#8b949e', level3: '#c9d1d9', level4: '#ffffff',
    text: '#8b949e', accent: '#ffffff', bg: '#0d1117'
  },
  light: {
    level0: '#ebedf0', level1: '#afb8c1', level2: '#6e7681', level3: '#30363d', level4: '#161b22',
    text: '#57606a', accent: '#1f2328', bg: '#ffffff'
  }
};

// GET endpoint to return a dynamic SVG badge of the contribution grid
app.get('/api/svg/:username', async (req, res) => {
  const { username } = req.params;
  const themeQuery = req.query.theme || 'green';
  const yearQuery = req.query.year;

  if (!username) {
    return res.status(400).send('Username is required');
  }

  const theme = themes[themeQuery] || themes.green;

  try {
    const data = await getContributionsData(username);
    
    // Determine the year to display
    const years = Object.keys(data.total).sort((a, b) => b - a);
    if (years.length === 0) {
      throw new Error('No contribution years found for this user.');
    }
    const year = yearQuery && data.total[yearQuery] !== undefined ? yearQuery : years[0];
    const totalCount = data.total[year] || 0;

    // Filter contributions for the selected year
    const yearContributions = data.contributions.filter(c => c.date.startsWith(`${year}-`));
    yearContributions.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Group contributions by month
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyGroups = Array(12).fill(null).map(() => []);
    yearContributions.forEach(day => {
      const parts = day.date.split('-');
      const monthIdx = parseInt(parts[1], 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        monthlyGroups[monthIdx].push(day);
      }
    });

    // We will calculate width dynamically based on months
    let currentX = 20; // Left padding
    const monthHeaders = [];
    const cellRects = [];

    monthlyGroups.forEach((monthDays, monthIdx) => {
      if (monthDays.length === 0) return;

      const firstDateUTC = new Date(monthDays[0].date + 'T00:00:00Z');
      const startOffset = firstDateUTC.getUTCDay();

      const lastDateUTC = new Date(monthDays[monthDays.length - 1].date + 'T00:00:00Z');
      const endOffset = 6 - lastDateUTC.getUTCDay();

      const cols = Math.ceil((startOffset + monthDays.length + endOffset) / 7);
      const monthWidth = cols * 14 - 3;

      // Add month header text centered above the block
      monthHeaders.push(
        `<text x="${currentX + monthWidth / 2}" y="65" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" fill="${theme.text}">${monthNames[monthIdx]}</text>`
      );

      // Draw cells
      for (let index = 0; index < cols * 7; index++) {
        if (index < startOffset || index >= startOffset + monthDays.length) {
          continue; // Empty placeholder cell
        }

        const day = monthDays[index - startOffset];
        const row = index % 7;
        const col = Math.floor(index / 7);

        const cellX = currentX + col * 14;
        const cellY = 80 + row * 14;
        const fill = theme['level' + day.level] || theme.level0;

        cellRects.push(
          `<rect x="${cellX}" y="${cellY}" width="11" height="11" rx="2" fill="${fill}" />`
        );
      }

      // Shift x position for next month (cols * 14 + 11px offset)
      currentX += cols * 14 + 11;
    });

    // Total width of graph area: currentX minus the last month's extra gap of 14px (meaning offset was added extra in the loop)
    const cardWidth = currentX - 14 + 20;
    
    // Compile SVG Content
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="210" viewBox="0 0 ${cardWidth} 210">
  <style>
    .text-title { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 15px; font-weight: 700; }
    .text-subtitle { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 11px; }
    .text-caption { font-family: system-ui, -apple-system, sans-serif; font-size: 10px; }
  </style>

  <!-- Background Card -->
  <rect width="${cardWidth}" height="210" rx="12" fill="${theme.bg}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

  <!-- Header -->
  <text x="20" y="30" class="text-title" fill="${theme.accent}">@${username}</text>
  <text x="20" y="45" class="text-subtitle" fill="${theme.text}">${totalCount.toLocaleString()} contributions in ${year}</text>
  <text x="${cardWidth - 20}" y="32" text-anchor="end" class="text-title" fill="${theme.accent}">${year}</text>

  <!-- Month Headers -->
  ${monthHeaders.join('\n  ')}

  <!-- Contribution Cells -->
  ${cellRects.join('\n  ')}

  <!-- Footer -->
  <text x="20" y="190" class="text-caption" fill="${theme.text}" opacity="0.6">GitPulse Dashboard Badge</text>

  <!-- Legend -->
  <text x="${cardWidth - 128}" y="190" text-anchor="end" class="text-caption" fill="${theme.text}">Less</text>
  <rect x="${cardWidth - 122}" y="181" width="11" height="11" rx="2" fill="${theme.level0}" />
  <rect x="${cardWidth - 108}" y="181" width="11" height="11" rx="2" fill="${theme.level1}" />
  <rect x="${cardWidth - 94}" y="181" width="11" height="11" rx="2" fill="${theme.level2}" />
  <rect x="${cardWidth - 80}" y="181" width="11" height="11" rx="2" fill="${theme.level3}" />
  <rect x="${cardWidth - 66}" y="181" width="11" height="11" rx="2" fill="${theme.level4}" />
  <text x="${cardWidth - 20}" y="190" text-anchor="end" class="text-caption" fill="${theme.text}">More</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
    return res.send(svg);
  } catch (error) {
    console.error(`[Error] SVG Generation failed: ${error.message}`);
    return res.status(500).send(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80">
      <rect width="300" height="80" rx="8" fill="#1f1f1f" stroke="#f85149" stroke-width="1"/>
      <text x="15" y="30" font-family="sans-serif" font-size="12" fill="#f85149" font-weight="bold">Error Generating Pulse Badge</text>
      <text x="15" y="50" font-family="sans-serif" font-size="10" fill="#8b949e">${error.message}</text>
    </svg>`);
  }
});

// For any other request, send index.html
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` GitHub Contribution Grid Server running on port ${PORT}`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`===================================================`);
  });
}

module.exports = app;
