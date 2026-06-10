const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Load environment variables manually from .env file if it exists
if (fs.existsSync(path.join(__dirname, '.env'))) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const separatorIdx = trimmedLine.indexOf('=');
        if (separatorIdx > 0) {
          const key = trimmedLine.substring(0, separatorIdx).trim();
          const val = trimmedLine.substring(separatorIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          process.env[key] = val;
        }
      }
    });
  } catch (err) {
    console.error(`[Warning] Failed to read .env file: ${err.message}`);
  }
}

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
    topRepo: { name: 'None', stars: 0, forks: 0 },
    rateLimited: false
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

    let rateLimited = false;
    [userRes, reposRes, prsRes].forEach(res => {
      if (res.status === 'rejected') {
        const reason = res.reason;
        if (reason && reason.response) {
          if (reason.response.status === 403 || reason.response.status === 429) {
            rateLimited = true;
          }
        }
      }
    });

    stats.rateLimited = rateLimited;
    if (rateLimited) {
      console.warn(`[GitHub API Warning] Rate limit hit for user: ${username}. Stats are incomplete. Set a GITHUB_TOKEN to increase limits.`);
    }

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
  const normalizedUsername = username.toLowerCase();

  // Check cache first
  const cachedData = cache.get(normalizedUsername);
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

      // Save to cache only if not rate limited
      if (githubStats && !githubStats.rateLimited) {
        cache.set(normalizedUsername, {
          timestamp: Date.now(),
          data: mergedData
        });
      }
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

        // Save to cache only if not rate limited
        if (githubStats && !githubStats.rateLimited) {
          cache.set(normalizedUsername, {
            timestamp: Date.now(),
            data: scrapedData
          });
        }

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
    // Set dynamic Cache-Control based on rate limit status
    if (data.githubStats && data.githubStats.rateLimited) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=600');
    }
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
  dark: {
    level0: '#161b22', level1: '#0e4429', level2: '#006d32', level3: '#26a641', level4: '#39d353',
    text: '#8b949e', accent: '#ffffff', bg: '#0d1117'
  },
  light: {
    level0: '#ebedf0', level1: '#9be9a8', level2: '#40c463', level3: '#30a14e', level4: '#216e39',
    text: '#57606a', accent: '#216e39', bg: '#ffffff'
  }
};

// GET endpoint to return a dynamic SVG badge of the contribution grid
app.get('/api/svg/:username', async (req, res) => {
  const { username } = req.params;
  let themeQuery = req.query.theme || 'dark';
  const yearQuery = req.query.year;

  if (!username) {
    return res.status(400).send('Username is required');
  }

  // Gracefully fallback legacy themes (green, purple, etc.) to dark theme, and white to dark as it was a dark card
  if (themeQuery !== 'light') {
    themeQuery = 'dark';
  }

  const theme = themes[themeQuery];

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
  <rect x="${cardWidth - 87}" y="181" width="11" height="11" rx="2" fill="${theme.level0}" />
  <rect x="${cardWidth - 73}" y="181" width="11" height="11" rx="2" fill="${theme.level1}" />
  <rect x="${cardWidth - 59}" y="181" width="11" height="11" rx="2" fill="${theme.level2}" />
  <rect x="${cardWidth - 45}" y="181" width="11" height="11" rx="2" fill="${theme.level3}" />
  <rect x="${cardWidth - 31}" y="181" width="11" height="11" rx="2" fill="${theme.level4}" />
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

// GET endpoint to return a dynamic SVG badge of a specific analytics card
app.get('/api/svg/:username/card/:cardId', async (req, res) => {
  const { username, cardId } = req.params;
  let themeQuery = req.query.theme || 'dark';
  const yearQuery = req.query.year;

  if (!username) {
    return res.status(400).send('Username is required');
  }

  // Fallback themes
  if (themeQuery !== 'light') {
    themeQuery = 'dark';
  }

  const theme = themes[themeQuery];

  try {
    const data = await getContributionsData(username);
    const githubStats = data.githubStats || {
      followers: 0,
      publicRepos: 0,
      totalPrsAccepted: 0,
      topRepo: { name: '-', stars: 0, forks: 0 }
    };

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

    // Helper functions
    const escapeXml = (unsafe) => {
      if (typeof unsafe !== 'string') return unsafe;
      return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
        }
      });
    };

    const calculateStreaks = (allContributions) => {
      const sorted = [...allContributions].sort((a, b) => new Date(a.date) - new Date(b.date));
      let longestStreak = 0;
      let longestStart = null;
      let longestEnd = null;
      let tempStreak = 0;
      let tempStart = null;

      for (let i = 0; i < sorted.length; i++) {
        const day = sorted[i];
        if (day.count > 0) {
          if (tempStreak === 0) tempStart = day.date;
          tempStreak++;
          if (tempStreak > longestStreak) {
            longestStreak = tempStreak;
            longestStart = tempStart;
            longestEnd = day.date;
          }
        } else {
          tempStreak = 0;
          tempStart = null;
        }
      }

      const localToday = new Date();
      const yr = localToday.getFullYear();
      const mo = String(localToday.getMonth() + 1).padStart(2, '0');
      const dy = String(localToday.getDate()).padStart(2, '0');
      const todayStr = `${yr}-${mo}-${dy}`;
      
      let lastIndex = sorted.length - 1;
      while (lastIndex >= 0 && sorted[lastIndex].date > todayStr) {
        lastIndex--;
      }

      let currentStreakCount = 0;
      let currentStart = null;
      let currentEnd = null;
      let isStreakActive = false;

      if (lastIndex >= 0) {
        const lastDay = sorted[lastIndex];
        if (lastDay.count > 0) {
          isStreakActive = true;
        } else if (lastIndex > 0) {
          const yesterdayDay = sorted[lastIndex - 1];
          if (yesterdayDay.count > 0) {
            const diffTime = Math.abs(new Date(lastDay.date) - new Date(yesterdayDay.date));
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 1) {
              isStreakActive = true;
              lastIndex = lastIndex - 1;
            }
          }
        }
      }

      if (isStreakActive) {
        currentEnd = sorted[lastIndex].date;
        let j = lastIndex;
        while (j >= 0 && sorted[j].count > 0) {
          currentStreakCount++;
          currentStart = sorted[j].date;
          if (j > 0) {
            const d1 = new Date(sorted[j].date);
            const d2 = new Date(sorted[j - 1].date);
            const diffTime = Math.abs(d1 - d2);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 1) break;
          }
          j--;
        }
      }

      return {
        currentStreak: currentStreakCount,
        currentStart,
        currentEnd,
        longestStreak,
        longestStart,
        longestEnd
      };
    };

    const formatDateRange = (startDateStr, endDateStr) => {
      if (!startDateStr || !endDateStr) return '';
      const options = { month: 'short', day: 'numeric' };
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      const startFormatted = start.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
      const startYear = start.getUTCFullYear();
      const endYear = end.getUTCFullYear();
      if (startYear !== endYear) {
        return `${startFormatted}, ${startYear} - ${end.toLocaleDateString('en-US', { ...options, year: 'numeric', timeZone: 'UTC' })}`;
      }
      const endFormatted = end.toLocaleDateString('en-US', { ...options, year: 'numeric', timeZone: 'UTC' });
      return `${startFormatted} - ${endFormatted}`;
    };

    const wrapCard = (width, height, content, defs = '') => {
      const strokeColor = themeQuery === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 35, 40, 0.15)';
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .text-title { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 14px; font-weight: 700; }
    .text-label { font-family: system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .text-val { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 20px; font-weight: 700; }
    .text-trend { font-family: system-ui, -apple-system, sans-serif; font-size: 10px; }
  </style>
  ${defs}
  <rect width="${width}" height="${height}" rx="16" fill="${theme.bg}" stroke="${strokeColor}" stroke-width="1" />
  ${content}
</svg>`;
    };

    const makeMetricCard = (label, value, trend, iconColorKey, iconSvgPath) => {
      // Monochrome icon styling matching the website CSS
      const iconBg = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const iconColor = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const iconBorder = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      const content = `
  <!-- Icon Container -->
  <rect x="20" y="26" width="48" height="48" rx="12" fill="${iconBg}" stroke="${iconBorder}" stroke-width="1" />
  <g color="${iconColor}">
    <svg x="34" y="40" width="20" height="20" viewBox="0 0 24 24">
      ${iconSvgPath}
    </svg>
  </g>

  <!-- Metric Info -->
  <text x="84" y="38" class="text-label" fill="${theme.text}">${escapeXml(label)}</text>
  <text x="84" y="63" class="text-val" fill="${theme.accent}">${escapeXml(value)}</text>
  <text x="84" y="80" class="text-trend" fill="${theme.text}" opacity="0.8">${escapeXml(trend)}</text>
`;
      return wrapCard(300, 100, content);
    };

    let svg = '';

    if (cardId === 'total-contributions') {
      const path = `<path d="M11.644 18.062a1 1 0 0 1 .712 0l9-7.5A1 1 0 0 1 20 12.1v4a1.001 1.001 0 0 1-.356.768l-9 7.5a1.003 1.003 0 0 1-1.288 0l-9-7.5A1.001 1.001 0 0 1 0 16.1v-4a1 1 0 0 1 .644-.238l9 7.5a1 1 0 0 0 1.288 0z" fill="currentColor" opacity="0.6"/>
      <path d="M11.644 12.062a1 1 0 0 1 .712 0l9-7.5A1 1 0 0 1 20 6.1v4a1.001 1.001 0 0 1-.356.768l-9 7.5a1.003 1.003 0 0 1-1.288 0l-9-7.5A1.001 1.001 0 0 1 0 10.1v-4a1 1 0 0 1 .644-.238l9 7.5a1 1 0 0 0 1.288 0z" fill="currentColor" opacity="0.8"/>
      <path d="M12 2a1 1 0 0 1 .64.23l9 7.5a1 1 0 0 1 0 1.54l-9 7.5a1 1 0 0 1-1.28 0l-9-7.5a1 1 0 0 1 0-1.54l9-7.5A1 1 0 0 1 12 2z" fill="currentColor"/>`;
      svg = makeMetricCard('Total Contributions', totalCount.toLocaleString(), `Activity in ${year}`, 'green', path);
    } 
    else if (cardId === 'current-streak') {
      const streakData = calculateStreaks(data.contributions);
      const path = '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" fill="currentColor"/>';
      const trendText = streakData.currentStreak > 0 ? formatDateRange(streakData.currentStart, streakData.currentEnd) : 'No active streak';
      svg = makeMetricCard('Current Streak', `${streakData.currentStreak} days`, trendText, 'purple', path);
    } 
    else if (cardId === 'longest-streak') {
      const streakData = calculateStreaks(data.contributions);
      const path = '<path d="M21 4h-3V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v1H3a2 2 0 0 0-2 2v3a4 4 0 0 0 4 4h1.54a5.27 5.27 0 0 0 4.13 4.86L9 20h-1a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-1l-.67-3.14A5.27 5.27 0 0 0 18.46 13H20a4 4 0 0 0 4-4V6a2 2 0 0 0-2-2zM5 11a2 2 0 0 1-2-2V6h2zm16-2a2 2 0 0 1-2 2v-5h2z" fill="currentColor"/>';
      const trendText = streakData.longestStreak > 0 ? formatDateRange(streakData.longestStart, streakData.longestEnd) : 'All-time record';
      svg = makeMetricCard('Longest Streak', `${streakData.longestStreak} days`, trendText, 'orange', path);
    } 
    else if (cardId === 'active-ratio') {
      const totalDays = yearContributions.length;
      const activeCount = yearContributions.filter(c => c.count > 0).length;
      const ratio = totalDays > 0 ? ((activeCount / totalDays) * 100).toFixed(1) : '0.0';
      const path = '<path d="M12 2c5.52 0 10 4.48 10 10s-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm-2 15l8-8-1.41-1.41L10 14.17l-3.59-3.58L5 12l5 5z" fill="currentColor"/>';
      svg = makeMetricCard('Active Days Ratio', `${ratio}%`, `${activeCount} of ${totalDays} active days`, 'blue', path);
    } 
    else if (cardId === 'prs-accepted') {
      const path = '<path d="M18.5 13c-1.04 0-1.93.64-2.31 1.54L10.5 14c-.83 0-1.5-.67-1.5-1.5V7.81c.92-.38 1.5-1.29 1.5-2.31 0-1.38-1.12-2.5-2.5-2.5S5.5 4.12 5.5 5.5c0 1.02.58 1.93 1.5 2.31v4.69c0 2.48 2.02 4.5 4.5 4.5h5.69c.38.9 1.27 1.54 2.31 1.54 1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5zm-11-7.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zm11 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5z" fill="currentColor"/>';
      svg = makeMetricCard('PRs Accepted', (githubStats.totalPrsAccepted || 0).toLocaleString(), 'Merged pull requests', 'purple', path);
    } 
    else if (cardId === 'followers') {
      const path = '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 2 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/>';
      svg = makeMetricCard('Followers', (githubStats.followers || 0).toLocaleString(), 'Community reach', 'blue', path);
    } 
    else if (cardId === 'public-repos') {
      const path = '<path d="M18 2H6a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3zm-3 18H9v-6h6v6zm4-10H5V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v5z" fill="currentColor"/>';
      svg = makeMetricCard('Public Repos', (githubStats.publicRepos || 0).toLocaleString(), 'Public repositories', 'green', path);
    } 
    else if (cardId === 'top-repo') {
      const path = '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>';
      const repo = githubStats.topRepo || { name: '-', stars: 0, forks: 0 };
      svg = makeMetricCard('Top Starred Repo', repo.name, `★ ${repo.stars.toLocaleString()}  •  ⑂ ${repo.forks.toLocaleString()}`, 'orange', path);
    } 
    else if (cardId === 'weekly-activity') {
      const daysData = Array(7).fill(0);
      const daysName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      yearContributions.forEach(c => {
        const dayIdx = new Date(c.date + 'T00:00:00Z').getUTCDay();
        daysData[dayIdx] += c.count;
      });
      const maxCount = Math.max(...daysData, 1);

      const gradColorStart = themeQuery === 'dark' ? '#dcdcdc' : '#8c959f';
      const gradColorEnd = themeQuery === 'dark' ? '#ffffff' : '#161b22';
      const defs = `
        <defs>
          <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="${gradColorStart}" />
            <stop offset="100%" stop-color="${gradColorEnd}" />
          </linearGradient>
        </defs>
      `;

      // Monochrome header icon styling matching the website
      const headerIconBgWeekly = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const headerIconColorWeekly = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const headerIconBorderWeekly = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      let barsHtml = '';
      for (let i = 0; i < 7; i++) {
        const count = daysData[i];
        const percent = count / maxCount;
        const barHeight = Math.round(percent * 100);
        const barX = 40 + i * 40;
        const barY = 200 - barHeight;

        barsHtml += `
  <!-- Bar Track -->
  <rect x="${barX}" y="80" width="20" height="120" rx="4" fill="${themeQuery === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'}" />
  <!-- Bar Fill -->
  <rect x="${barX}" y="${barY}" width="20" height="${barHeight}" rx="4" fill="url(#barGrad)" />
  <!-- Value Text -->
  <text x="${barX + 10}" y="${barY - 8}" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" text-anchor="middle" fill="${theme.accent}">${count}</text>
  <!-- Label Text -->
  <text x="${barX + 10}" y="220" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" text-anchor="middle" fill="${theme.text}">${daysName[i]}</text>
`;
      }

      const headerIconBg = headerIconBgWeekly;
      const headerIconColor = headerIconColorWeekly;

      const content = `
  <!-- Header Icon -->
  <rect x="20" y="20" width="32" height="32" rx="8" fill="${headerIconBg}" stroke="${headerIconBorderWeekly}" stroke-width="1" />
  <g color="${headerIconColor}">
    <svg x="26" y="26" width="20" height="20" viewBox="0 0 24 24">
      <path d="M19 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14h11a1 1 0 0 1 0 2zm-7-6h2v4h-2v-4zm-4-4h2v8H8v-8zm8 2h2v6h-2v-6z" fill="currentColor"/>
    </svg>
  </g>
  
  <text x="60" y="41" class="text-title" fill="${theme.accent}">Day of Week Activity</text>

  <!-- Chart Bars -->
  ${barsHtml}
`;
      svg = wrapCard(340, 260, content, defs);
    } 
    else if (cardId === 'monthly-weight') {
      const monthsData = Array(12).fill(0);
      const monthsName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      yearContributions.forEach(c => {
        const monthIdx = new Date(c.date + 'T00:00:00Z').getUTCMonth();
        monthsData[monthIdx] += c.count;
      });
      const maxCount = Math.max(...monthsData, 1);

      const gradColorStartM = themeQuery === 'dark' ? '#dcdcdc' : '#8c959f';
      const gradColorEndM = themeQuery === 'dark' ? '#ffffff' : '#161b22';
      const defs = `
        <defs>
          <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="${gradColorStartM}" />
            <stop offset="100%" stop-color="${gradColorEndM}" />
          </linearGradient>
        </defs>
      `;

      // Monochrome header icon styling matching the website
      const headerIconBgMonthly = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const headerIconColorMonthly = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const headerIconBorderMonthly = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      let barsHtml = '';
      for (let i = 0; i < 12; i++) {
        const count = monthsData[i];
        const percent = count / maxCount;
        const barHeight = Math.round(percent * 100);
        const barX = 36 + i * 32;
        const barY = 200 - barHeight;

        barsHtml += `
  <!-- Bar Track -->
  <rect x="${barX}" y="80" width="16" height="120" rx="4" fill="${themeQuery === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'}" />
  <!-- Bar Fill -->
  <rect x="${barX}" y="${barY}" width="16" height="${barHeight}" rx="4" fill="url(#barGrad)" />
  <!-- Value Text -->
  <text x="${barX + 8}" y="${barY - 8}" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="600" text-anchor="middle" fill="${theme.accent}">${count}</text>
  <!-- Label Text -->
  <text x="${barX + 8}" y="220" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="600" text-anchor="middle" fill="${theme.text}">${monthsName[i]}</text>
`;
      }

      const headerIconBg = headerIconBgMonthly;
      const headerIconColor = headerIconColorMonthly;

      const content = `
  <!-- Header Icon -->
  <rect x="20" y="20" width="32" height="32" rx="8" fill="${headerIconBg}" stroke="${headerIconBorderMonthly}" stroke-width="1" />
  <g color="${headerIconColor}">
    <svg x="26" y="26" width="20" height="20" viewBox="0 0 24 24">
      <path d="M19 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14h11a1 1 0 0 1 0 2zm-4.3-8.3l-2.7 2.7a1 1 0 0 1-1.4 0L8 11.8l-2.3 2.3a1 1 0 0 1-1.4-1.4l3-3a1 1 0 0 1 1.4 0l2.6 2.6 2-2a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4 1 1 0 0 1-1.4 0z" fill="currentColor"/>
    </svg>
  </g>
  
  <text x="60" y="41" class="text-title" fill="${theme.accent}">Monthly Contribution Weight</text>

  <!-- Chart Bars -->
  ${barsHtml}
`;
      svg = wrapCard(440, 260, content, defs);
    } 
    else if (cardId === 'pulse-insights') {
      // 1. Daily Average
      const totalDays = yearContributions.length;
      const dailyAvg = totalDays > 0 ? (totalCount / totalDays).toFixed(2) : '0.00';

      // 2. Peak Activity
      let peakDay = { count: 0, date: '-' };
      yearContributions.forEach(c => {
        if (c.count > peakDay.count) {
          peakDay = { count: c.count, date: c.date };
        }
      });
      const peakText = peakDay.count > 0 
        ? `${peakDay.count} contributions on ${new Date(peakDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
        : '0 contributions';

      // 3. Highest Consistency Month
      const monthsData = Array(12).fill(0);
      const monthsName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthsDaysCount = Array(12).fill(0);
      const monthsActiveDaysCount = Array(12).fill(0);

      yearContributions.forEach(c => {
        const monthIdx = new Date(c.date + 'T00:00:00Z').getUTCMonth();
        monthsData[monthIdx] += c.count;
        monthsDaysCount[monthIdx]++;
        if (c.count > 0) {
          monthsActiveDaysCount[monthIdx]++;
        }
      });

      let highestConsistency = { ratio: -1, month: '-' };
      monthsData.forEach((count, idx) => {
        if (monthsDaysCount[idx] > 0) {
          const activeRatio = monthsActiveDaysCount[idx] / monthsDaysCount[idx];
          if (activeRatio > highestConsistency.ratio && count > 0) {
            highestConsistency = { ratio: activeRatio, month: monthsName[idx] };
          }
        }
      });

      const consistencyText = highestConsistency.ratio > 0 
        ? `${highestConsistency.month} (${(highestConsistency.ratio * 100).toFixed(0)}% active days)`
        : 'No data available';

      // Monochrome icon styling matching the website
      const headerIconBg = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const headerIconColor = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const headerIconBorder = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      const bulletBg = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const bulletColor = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const bulletBorder = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      const listHtml = `
  <!-- Item 1: Daily Average -->
  <g transform="translate(20, 70)">
    <rect width="36" height="36" rx="10" fill="${bulletBg}" stroke="${bulletBorder}" stroke-width="1" />
    <g color="${bulletColor}">
      <svg x="8" y="8" width="20" height="20" viewBox="0 0 24 24">
        <rect x="4" y="2" width="16" height="20" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="12" y1="18" x2="16" y2="18" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="12" y1="14" x2="16" y2="14" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="8" y1="14" x2="8" y2="18" fill="none" stroke="currentColor" stroke-width="2"/>
        <rect x="8" y="6" width="8" height="4" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
    </g>
    <text x="48" y="15" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" fill="${theme.text}" text-transform="uppercase">Daily Average</text>
    <text x="48" y="31" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="${theme.accent}">${escapeXml(dailyAvg)} contributions / day</text>
  </g>

  <!-- Item 2: Peak Activity -->
  <g transform="translate(20, 130)">
    <rect width="36" height="36" rx="10" fill="${bulletBg}" stroke="${bulletBorder}" stroke-width="1" />
    <g color="${bulletColor}">
      <svg x="8" y="8" width="20" height="20" viewBox="0 0 24 24">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/>
      </svg>
    </g>
    <text x="48" y="15" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" fill="${theme.text}" text-transform="uppercase">Peak Activity</text>
    <text x="48" y="31" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="${theme.accent}">${escapeXml(peakText)}</text>
  </g>

  <!-- Item 3: Highest Consistency -->
  <g transform="translate(20, 190)">
    <rect width="36" height="36" rx="10" fill="${bulletBg}" stroke="${bulletBorder}" stroke-width="1" />
    <g color="${bulletColor}">
      <svg x="8" y="8" width="20" height="20" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="9" y1="9" x2="15" y2="9" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="9" y1="13" x2="15" y2="13" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="9" y1="17" x2="13" y2="17" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
    </g>
    <text x="48" y="15" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" fill="${theme.text}" text-transform="uppercase">Highest Consistency Month</text>
    <text x="48" y="31" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="${theme.accent}">${escapeXml(consistencyText)}</text>
  </g>
`;

      const content = `
  <!-- Header Icon -->
  <rect x="20" y="20" width="32" height="32" rx="8" fill="${headerIconBg}" stroke="${headerIconBorder}" stroke-width="1" />
  <g color="${headerIconColor}">
    <svg x="26" y="26" width="20" height="20" viewBox="0 0 24 24">
      <path d="M12 2C7.58 2 4 5.58 4 10c0 2.5 1.14 4.73 2.92 6.22C8.2 17.3 9 18.52 9 19.82V21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.18c0-1.3.8-2.52 2.08-3.6C18.86 14.73 20 12.5 20 10c0-4.42-3.58-8-8-8zm-2 18v-2h4v2h-4zm5-4.47c-.89.76-1.5 1.83-1.84 2.97h-2.32c-.34-1.14-.95-2.21-1.84-2.97C7.62 14.39 7 12.63 7 10.82c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.81-.62 3.57-2 4.71z" fill="currentColor"/>
    </svg>
  </g>
  
  <text x="60" y="41" class="text-title" fill="${theme.accent}">Pulse Insights</text>

  <!-- Insights List -->
  ${listHtml}
`;
      svg = wrapCard(340, 260, content);
    } 
    else {
      return res.status(404).send('Card ID not found');
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    return res.send(svg);

  } catch (error) {
    console.error(`[Error] SVG Card Generation failed: ${error.message}`);
    return res.status(500).send(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80">
      <rect width="300" height="80" rx="8" fill="#1f1f1f" stroke="#f85149" stroke-width="1"/>
      <text x="15" y="30" font-family="sans-serif" font-size="12" fill="#f85149" font-weight="bold">Error Generating Card Badge</text>
      <text x="15" y="50" font-family="sans-serif" font-size="10" fill="#8b949e">${error.message}</text>
    </svg>`);
  }
});

// ============================================================
// LeetCode Integration
// ============================================================

// Fetch LeetCode stats via GraphQL
async function fetchLeetCodeStats(username, year = null) {
  const defaultData = {
    username,
    profile: { realName: '', ranking: 0, reputation: 0, postViewCount: 0, solutionCount: 0, userAvatar: '' },
    submissions: { easy: 0, medium: 0, hard: 0, total: 0, easySolved: 0, mediumSolved: 0, hardSolved: 0, totalSolved: 0 },
    calendar: { streak: 0, totalActiveDays: 0, submissionCalendar: '{}', years: [new Date().getFullYear()] },
    contest: { attendedContestsCount: 0, rating: 0, globalRanking: 0, topPercentage: 0 }
  };

  const query = `query getUserProfile($username: String!, $year: Int) {
  matchedUser(username: $username) {
    username
    profile {
      realName
      ranking
      reputation
      postViewCount
      solutionCount
      userAvatar
    }
    submitStatsGlobal {
      acSubmissionNum {
        difficulty
        count
      }
    }
    userCalendar(year: $year) {
      activeYears
      streak
      totalActiveDays
      submissionCalendar
    }
  }
  userContestRanking(username: $username) {
    attendedContestsCount
    rating
    globalRanking
    topPercentage
  }
}`;

  try {
    const response = await axios.post('https://leetcode.com/graphql/', {
      query,
      variables: { username, year: year ? parseInt(year, 10) : undefined }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://leetcode.com'
      },
      timeout: 10000
    });

    const data = response.data?.data;
    if (!data || !data.matchedUser) {
      console.warn(`[LeetCode] No matched user found for: ${username}`);
      return defaultData;
    }

    const user = data.matchedUser;
    const profile = user.profile || {};
    const acStats = user.submitStatsGlobal?.acSubmissionNum || [];
    const cal = user.userCalendar || {};
    const contest = data.userContestRanking || {};

    // Parse submission stats
    const submissions = { easy: 0, medium: 0, hard: 0, total: 0, easySolved: 0, mediumSolved: 0, hardSolved: 0, totalSolved: 0 };
    acStats.forEach(item => {
      const d = item.difficulty;
      const c = item.count || 0;
      if (d === 'All') submissions.totalSolved = c;
      else if (d === 'Easy') submissions.easySolved = c;
      else if (d === 'Medium') submissions.mediumSolved = c;
      else if (d === 'Hard') submissions.hardSolved = c;
    });

    // Fetch total problem counts (hardcoded known totals as LeetCode doesn't expose them easily in the same query)
    // These are approximate and will be overridden if available
    submissions.easy = 830;
    submissions.medium = 1740;
    submissions.hard = 760;
    submissions.total = submissions.easy + submissions.medium + submissions.hard;

    return {
      username: user.username || username,
      profile: {
        realName: profile.realName || '',
        ranking: profile.ranking || 0,
        reputation: profile.reputation || 0,
        postViewCount: profile.postViewCount || 0,
        solutionCount: profile.solutionCount || 0,
        userAvatar: profile.userAvatar || ''
      },
      submissions,
      calendar: {
        streak: cal.streak || 0,
        totalActiveDays: cal.totalActiveDays || 0,
        submissionCalendar: cal.submissionCalendar || '{}',
        years: cal.activeYears || (() => {
          let yearsList = [];
          try {
            const calObj = JSON.parse(cal.submissionCalendar || '{}');
            const yrs = new Set();
            Object.keys(calObj).forEach(ts => {
              const yr = new Date(parseInt(ts) * 1000).getUTCFullYear();
              if (yr) yrs.add(yr);
            });
            if (yrs.size === 0) {
              yrs.add(new Date().getFullYear());
            }
            yearsList = Array.from(yrs).sort((a, b) => b - a);
          } catch (e) {
            yearsList = [new Date().getFullYear()];
          }
          return yearsList;
        })()
      },
      contest: {
        attendedContestsCount: contest.attendedContestsCount || 0,
        rating: Math.round(contest.rating || 0),
        globalRanking: contest.globalRanking || 0,
        topPercentage: contest.topPercentage ? parseFloat(contest.topPercentage.toFixed(2)) : 0
      }
    };
  } catch (err) {
    console.error(`[LeetCode Error] Failed to fetch stats for ${username}: ${err.message}`);
    return defaultData;
  }
}

// Cached wrapper for LeetCode data
const LEETCODE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes cache TTL for LeetCode data

async function getLeetCodeData(username, year = null) {
  const yearKey = year ? `_${year}` : '';
  const cacheKey = `lc_${username.toLowerCase()}${yearKey}`;

  const cachedData = cache.get(cacheKey);
  if (cachedData && (Date.now() - cachedData.timestamp < LEETCODE_CACHE_TTL)) {
    console.log(`[Cache Hit] Serving LeetCode data for user: ${username} (year: ${year || 'current'})`);
    return cachedData.data;
  }

  console.log(`[API Fetch] Fetching LeetCode data for user: ${username} (year: ${year || 'current'})`);
  const data = await fetchLeetCodeStats(username, year);

  cache.set(cacheKey, {
    timestamp: Date.now(),
    data
  });

  return data;
}

// LeetCode JSON API endpoint
app.get('/api/leetcode/:username', async (req, res) => {
  const { username } = req.params;
  const yearQuery = req.query.year ? parseInt(req.query.year, 10) : null;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const data = await getLeetCodeData(username, yearQuery);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=600');
    return res.json(data);
  } catch (error) {
    console.error(`[Error] LeetCode API endpoint failed: ${error.message}`);
    return res.status(500).json({
      error: `Could not retrieve LeetCode data for ${username}`,
      details: error.message
    });
  }
});

// LeetCode SVG Card endpoint
app.get('/api/leetcode/svg/:username/card/:cardId', async (req, res) => {
  const { username, cardId } = req.params;
  let themeQuery = req.query.theme || 'dark';
  const yearQuery = req.query.year ? parseInt(req.query.year, 10) : null;

  if (!username) {
    return res.status(400).send('Username is required');
  }

  if (themeQuery !== 'light') {
    themeQuery = 'dark';
  }

  const theme = themes[themeQuery];

  try {
    const lcData = await getLeetCodeData(username, yearQuery);

    // Helpers (same patterns as GitHub cards)
    const escapeXml = (unsafe) => {
      if (typeof unsafe !== 'string') return String(unsafe);
      return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
        }
      });
    };

    const wrapCard = (width, height, content, defs = '') => {
      const strokeColor = themeQuery === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(31, 35, 40, 0.15)';
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .text-title { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 14px; font-weight: 700; }
    .text-label { font-family: system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .text-val { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 20px; font-weight: 700; }
    .text-trend { font-family: system-ui, -apple-system, sans-serif; font-size: 10px; }
  </style>
  ${defs}
  <rect width="${width}" height="${height}" rx="16" fill="${theme.bg}" stroke="${strokeColor}" stroke-width="1" />
  ${content}
</svg>`;
    };

    const makeMetricCard = (label, value, trend, iconSvgPath) => {
      const iconBg = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const iconColor = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const iconBorder = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      const content = `
  <!-- Icon Container -->
  <rect x="20" y="26" width="48" height="48" rx="12" fill="${iconBg}" stroke="${iconBorder}" stroke-width="1" />
  <g color="${iconColor}">
    <svg x="34" y="40" width="20" height="20" viewBox="0 0 24 24">
      ${iconSvgPath}
    </svg>
  </g>

  <!-- Metric Info -->
  <text x="84" y="38" class="text-label" fill="${theme.text}">${escapeXml(label)}</text>
  <text x="84" y="63" class="text-val" fill="${theme.accent}">${escapeXml(value)}</text>
  <text x="84" y="80" class="text-trend" fill="${theme.text}" opacity="0.8">${escapeXml(trend)}</text>
`;
      return wrapCard(300, 100, content);
    };

    let svg = '';

    if (cardId === 'total-solved') {
      const { submissions } = lcData;
      const solved = submissions.totalSolved;
      const total = submissions.total;
      const easy = submissions.easySolved;
      const medium = submissions.mediumSolved;
      const hard = submissions.hardSolved;
      const easyTotal = submissions.easy;
      const mediumTotal = submissions.medium;
      const hardTotal = submissions.hard;

      // Donut chart parameters
      const cx = 75, cy = 75, r = 45;
      const circumference = 2 * Math.PI * r;
      const solvedRatio = total > 0 ? solved / total : 0;
      const solvedArc = circumference * solvedRatio;
      const remainingArc = circumference - solvedArc;

      // Monochrome arc colors
      const arcColor = themeQuery === 'dark' ? '#ffffff' : '#1f2328';
      const trackColor = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      const iconBg = themeQuery === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
      const iconBorder = themeQuery === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      // Difficulty label colors (monochrome shades)
      const easyColor = themeQuery === 'dark' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
      const mediumColor = themeQuery === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
      const hardColor = themeQuery === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';

      const content = `
  <!-- Donut Chart -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="8" />
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${arcColor}" stroke-width="8"
    stroke-dasharray="${solvedArc} ${remainingArc}"
    stroke-dashoffset="${circumference * 0.25}"
    stroke-linecap="round"
    transform="rotate(-90 ${cx} ${cy})" />

  <!-- Center text -->
  <text x="${cx}" y="${cy + 1}" text-anchor="middle" font-family="'Outfit', system-ui, -apple-system, sans-serif" fill="${theme.accent}">
    <tspan font-size="16" font-weight="800">${solved}</tspan><tspan font-size="9" font-weight="500" fill="${theme.text}" opacity="0.6">/${total}</tspan>
  </text>
  <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="9" fill="${theme.text}" opacity="0.8">✓ Solved</text>

  <!-- Difficulty breakdown -->
  <g transform="translate(155, 35)">
    <rect width="130" height="30" rx="6" fill="${iconBg}" stroke="${iconBorder}" stroke-width="1" />
    <text x="10" y="19" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="${easyColor}">Easy</text>
    <text x="120" y="19" text-anchor="end" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${theme.accent}">${easy}/${easyTotal}</text>
  </g>
  <g transform="translate(155, 72)">
    <rect width="130" height="30" rx="6" fill="${iconBg}" stroke="${iconBorder}" stroke-width="1" />
    <text x="10" y="19" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="${mediumColor}">Medium</text>
    <text x="120" y="19" text-anchor="end" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${theme.accent}">${medium}/${mediumTotal}</text>
  </g>
  <g transform="translate(155, 109)">
    <rect width="130" height="30" rx="6" fill="${iconBg}" stroke="${iconBorder}" stroke-width="1" />
    <text x="10" y="19" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="${hardColor}">Hard</text>
    <text x="120" y="19" text-anchor="end" font-family="'Outfit', system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${theme.accent}">${hard}/${hardTotal}</text>
  </g>
`;
      svg = wrapCard(300, 150, content);
    }
    else if (cardId === 'contest-rating') {
      const { contest } = lcData;
      const trophyIcon = '<path d="M21 4h-3V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v1H3a2 2 0 0 0-2 2v3a4 4 0 0 0 4 4h1.54a5.27 5.27 0 0 0 4.13 4.86L9 20h-1a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-1l-.67-3.14A5.27 5.27 0 0 0 18.46 13H20a4 4 0 0 0 4-4V6a2 2 0 0 0-2-2zM5 11a2 2 0 0 1-2-2V6h2zm16-2a2 2 0 0 1-2 2v-5h2z" fill="currentColor"/>';
      const rankText = contest.globalRanking > 0 ? `Global rank #${contest.globalRanking.toLocaleString()}` : 'No contest data';
      svg = makeMetricCard('Contest Rating', String(contest.rating), rankText, trophyIcon);
    }
    else if (cardId === 'max-streak') {
      const { calendar } = lcData;
      const fireIcon = '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" fill="currentColor"/>';
      svg = makeMetricCard('Max Streak', `${calendar.streak} days`, 'Maximum submission streak', fireIcon);
    }
    else if (cardId === 'views') {
      const { profile } = lcData;
      const eyeIcon = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/>';
      svg = makeMetricCard('Profile Views', (profile.postViewCount || 0).toLocaleString(), 'Profile views', eyeIcon);
    }
    else if (cardId === 'reputation') {
      const { profile } = lcData;
      const starIcon = '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/>';
      const rankText = profile.ranking > 0 ? `Rank #${profile.ranking.toLocaleString()}` : 'Unranked';
      svg = makeMetricCard('Reputation', String(profile.reputation), rankText, starIcon);
    }
    else if (cardId === 'solutions') {
      const { profile } = lcData;
      const bulbIcon = '<path d="M12 2C7.58 2 4 5.58 4 10c0 2.5 1.14 4.73 2.92 6.22C8.2 17.3 9 18.52 9 19.82V21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.18c0-1.3.8-2.52 2.08-3.6C18.86 14.73 20 12.5 20 10c0-4.42-3.58-8-8-8zm-2 18v-2h4v2h-4zm5-4.47c-.89.76-1.5 1.83-1.84 2.97h-2.32c-.34-1.14-.95-2.21-1.84-2.97C7.62 14.39 7 12.63 7 10.82c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.81-.62 3.57-2 4.71z" fill="currentColor"/>';
      svg = makeMetricCard('Solutions', String(profile.solutionCount || 0), 'Published solutions', bulbIcon);
    }
    else if (cardId === 'submission-calendar') {
      // Parse submission calendar
      let calendarData = {};
      try {
        calendarData = JSON.parse(lcData.calendar.submissionCalendar || '{}');
      } catch (e) {
        calendarData = {};
      }

      // Build contribution data for selected year
      const now = new Date();
      let currentYear = now.getFullYear();
      if (req.query.year) {
        const parsedYear = parseInt(req.query.year, 10);
        if (!isNaN(parsedYear) && parsedYear > 2000 && parsedYear < 2100) {
          currentYear = parsedYear;
        }
      }
      const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
      const endOfYear = new Date(Date.UTC(currentYear, 11, 31));

      // Map timestamps to date → count
      const dateMap = {};
      Object.entries(calendarData).forEach(([ts, count]) => {
        const d = new Date(parseInt(ts) * 1000);
        const yr = d.getUTCFullYear();
        if (yr === currentYear) {
          const dateStr = `${yr}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          dateMap[dateStr] = (dateMap[dateStr] || 0) + count;
        }
      });

      // Build full year data with levels
      const contributions = [];
      let totalSubmissions = 0;
      const d = new Date(startOfYear);
      while (d <= endOfYear) {
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const count = dateMap[dateStr] || 0;
        totalSubmissions += count;

        let level = 0;
        if (count >= 10) level = 4;
        else if (count >= 5) level = 3;
        else if (count >= 2) level = 2;
        else if (count >= 1) level = 1;

        contributions.push({ date: dateStr, count, level });
        d.setUTCDate(d.getUTCDate() + 1);
      }

      // Group by month (same pattern as GitHub grid)
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthlyGroups = Array(12).fill(null).map(() => []);
      contributions.forEach(day => {
        const parts = day.date.split('-');
        const monthIdx = parseInt(parts[1], 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
          monthlyGroups[monthIdx].push(day);
        }
      });

      let currentX = 20;
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

        monthHeaders.push(
          `<text x="${currentX + monthWidth / 2}" y="65" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" fill="${theme.text}">${monthNames[monthIdx]}</text>`
        );

        for (let index = 0; index < cols * 7; index++) {
          if (index < startOffset || index >= startOffset + monthDays.length) {
            continue;
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

        currentX += cols * 14 + 11;
      });

      const cardWidth = currentX - 14 + 20;

      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="210" viewBox="0 0 ${cardWidth} 210">
  <style>
    .text-title { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 15px; font-weight: 700; }
    .text-subtitle { font-family: 'Outfit', system-ui, -apple-system, sans-serif; font-size: 11px; }
    .text-caption { font-family: system-ui, -apple-system, sans-serif; font-size: 10px; }
  </style>

  <!-- Background Card -->
  <rect width="${cardWidth}" height="210" rx="12" fill="${theme.bg}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

  <!-- Header -->
  <text x="20" y="30" class="text-title" fill="${theme.accent}">@${escapeXml(username)}</text>
  <text x="20" y="45" class="text-subtitle" fill="${theme.text}">${totalSubmissions.toLocaleString()} submissions in ${currentYear}</text>
  <text x="${cardWidth - 20}" y="32" text-anchor="end" class="text-title" fill="${theme.accent}">${currentYear}</text>

  <!-- Month Headers -->
  ${monthHeaders.join('\n  ')}

  <!-- Contribution Cells -->
  ${cellRects.join('\n  ')}

  <!-- Footer -->
  <text x="20" y="190" class="text-caption" fill="${theme.text}" opacity="0.6">LeetCode Submission Calendar</text>

  <!-- Legend -->
  <rect x="${cardWidth - 87}" y="181" width="11" height="11" rx="2" fill="${theme.level0}" />
  <rect x="${cardWidth - 73}" y="181" width="11" height="11" rx="2" fill="${theme.level1}" />
  <rect x="${cardWidth - 59}" y="181" width="11" height="11" rx="2" fill="${theme.level2}" />
  <rect x="${cardWidth - 45}" y="181" width="11" height="11" rx="2" fill="${theme.level3}" />
  <rect x="${cardWidth - 31}" y="181" width="11" height="11" rx="2" fill="${theme.level4}" />
</svg>`;
    }
    else {
      return res.status(404).send('Card ID not found');
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    return res.send(svg);

  } catch (error) {
    console.error(`[Error] LeetCode SVG Card Generation failed: ${error.message}`);
    return res.status(500).send(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80">
      <rect width="300" height="80" rx="8" fill="#1f1f1f" stroke="#f85149" stroke-width="1"/>
      <text x="15" y="30" font-family="sans-serif" font-size="12" fill="#f85149" font-weight="bold">Error Generating LeetCode Card</text>
      <text x="15" y="50" font-family="sans-serif" font-size="10" fill="#8b949e">${error.message}</text>
    </svg>`);
  }
});

// For any other request, send index.html

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
