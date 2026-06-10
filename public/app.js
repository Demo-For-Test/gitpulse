/* ==========================================================================
   GitPulse - Client-Side Application Logic (Vanilla JavaScript)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  
  // --- DOM Elements References ---
  const searchForm = document.getElementById('search-form');
  const usernameInput = document.getElementById('username-input');
  const searchSubmitBtn = document.getElementById('search-submit-btn');
  const errorMessage = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  
  const splashContent = document.getElementById('splash-content');
  const loaderContent = document.getElementById('loader-content');
  const dashboardContent = document.getElementById('dashboard-content');
  
  // User profile elements
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const userUsername = document.getElementById('user-username');
  const userGithubLink = document.getElementById('user-github-link');
  
  // Grid elements
  const yearTabs = document.getElementById('year-tabs');
  const contributionsGrid = document.getElementById('contributions-grid');
  const gridActivitySummary = document.getElementById('grid-activity-summary');
  
  // Metrics elements
  const statTotal = document.getElementById('stat-total');
  const statTotalPeriod = document.getElementById('stat-total-period');
  const statCurrentStreak = document.getElementById('stat-current-streak');
  const statCurrentStreakRange = document.getElementById('stat-current-streak-range');
  const statLongestStreak = document.getElementById('stat-longest-streak');
  const statLongestStreakRange = document.getElementById('stat-longest-streak-range');
  const statActiveRatio = document.getElementById('stat-active-ratio');
  const statActiveDaysCount = document.getElementById('stat-active-days-count');
  
  // GitHub stats elements
  const statPrs = document.getElementById('stat-prs');
  const statFollowers = document.getElementById('stat-followers');
  const statRepos = document.getElementById('stat-repos');
  const statTopRepoName = document.getElementById('stat-top-repo-name');
  const statTopRepoStars = document.getElementById('stat-top-repo-stars');
  const statTopRepoForks = document.getElementById('stat-top-repo-forks');
  
  // Chart elements
  const weeklyChart = document.getElementById('weekly-chart');
  const monthlyChart = document.getElementById('monthly-chart');
  
  // Insights elements
  const insightDailyAvg = document.getElementById('insight-daily-avg');
  const insightPeakDay = document.getElementById('insight-peak-day');
  const insightConsistencyMonth = document.getElementById('insight-consistency-month');
  
  // Tooltip element
  const tooltip = document.getElementById('grid-tooltip');
  const tooltipCount = document.getElementById('tooltip-count');
  const tooltipDate = document.getElementById('tooltip-date');
  
  // --- LeetCode DOM Elements ---
  const platformSelect = document.getElementById('platform-select');
  const leetcodeDashboard = document.getElementById('leetcode-dashboard');
  const lcDonutChart = document.getElementById('lc-donut-chart');
  const lcYearTabs = document.getElementById('lc-year-tabs');
  
  // --- App State ---
  let appData = null;
  let activeYear = null;
  let activePlatform = 'github'; // 'github' or 'leetcode'
  let lcData = null;
  let lcActiveYear = null;
  
  // --- Initialize Theme Handler (Dark / Light Mode Toggle) ---
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  
  function applyTheme(theme) {
    const isEmbedded = document.body.classList.contains('is-embedded');
    document.body.className = '';
    document.body.classList.add(`theme-${theme}`);
    if (isEmbedded) {
      document.body.classList.add('is-embedded');
    }
    
    // Update Toggle Icon
    const icon = themeToggleBtn.querySelector('i');
    if (theme === 'light') {
      icon.className = 'fa-solid fa-moon';
      themeToggleBtn.title = 'Switch to Dark Mode';
    } else {
      icon.className = 'fa-solid fa-sun';
      themeToggleBtn.title = 'Switch to Light Mode';
    }
    
    // Save to localStorage
    localStorage.setItem('theme', theme);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
    });
  }

  // --- Platform Selector Handler ---
  if (platformSelect) {
    platformSelect.addEventListener('change', () => {
      activePlatform = platformSelect.value;
      const username = usernameInput.value.trim();
      if (username) {
        if (activePlatform === 'leetcode') {
          fetchLeetCodeData(username);
        } else {
          fetchContributionData(username);
        }
      }
    });
  }

  // --- Form Submission Handler ---
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (username) {
      if (activePlatform === 'leetcode') {
        fetchLeetCodeData(username);
      } else {
        fetchContributionData(username);
      }
    }
  });

  // --- Fetch Contribution Data ---
  async function fetchContributionData(username) {
    // Ensure LeetCode dashboard is hidden
    if (leetcodeDashboard) leetcodeDashboard.classList.add('hidden');

    // Show loading state, hide others
    splashContent.classList.add('hidden');
    errorMessage.classList.add('hidden');
    dashboardContent.classList.add('hidden');
    loaderContent.classList.remove('hidden');
    searchSubmitBtn.disabled = true;
    searchSubmitBtn.querySelector('span').textContent = 'Analyzing...';

    try {
      const response = await fetch(`/api/contributions/${username}`, {
        cache: 'no-cache'
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch data for username: ${username}`);
      }
      
      const data = await response.json();
      appData = data;
      
      // Set profile details
      userUsername.textContent = username;
      userGithubLink.href = `https://github.com/${username}`;
      userAvatar.src = `https://github.com/${username}.png`; // Fetch public avatar
      
      // Populate GitHub Profile Stats
      if (data.githubStats) {
        statPrs.textContent = (data.githubStats.totalPrsAccepted || 0).toLocaleString();
        statFollowers.textContent = (data.githubStats.followers || 0).toLocaleString();
        statRepos.textContent = (data.githubStats.publicRepos || 0).toLocaleString();
        
        const topRepo = data.githubStats.topRepo || { name: 'None', stars: 0, forks: 0 };
        statTopRepoName.textContent = topRepo.name;
        statTopRepoName.title = topRepo.name; // Tooltip for full name
        
        statTopRepoStars.innerHTML = `<i class="fa-solid fa-star"></i> ${topRepo.stars.toLocaleString()}`;
        statTopRepoForks.innerHTML = `<i class="fa-solid fa-code-fork"></i> ${topRepo.forks.toLocaleString()}`;
      } else {
        // Fallback defaults
        statPrs.textContent = '0';
        statFollowers.textContent = '0';
        statRepos.textContent = '0';
        statTopRepoName.textContent = '-';
        statTopRepoStars.innerHTML = `<i class="fa-solid fa-star"></i> 0`;
        statTopRepoForks.innerHTML = `<i class="fa-solid fa-code-fork"></i> 0`;
      }
      
      // Try to fetch profile display name using Github Public API (async, non-blocking fallback)
      fetchGithubDisplayName(username);

      // Extract unique years from contributions and sort descending
      const years = Object.keys(data.total).sort((a, b) => b - a);
      
      if (years.length === 0) {
        throw new Error('No contribution years found for this user.');
      }

      // Populate Year Selectors
      renderYearTabs(years);

      // Set default active year (most recent or from URL parameter)
      const localUrlParams = new URLSearchParams(window.location.search);
      const yearParam = localUrlParams.get('year');
      if (yearParam && years.includes(yearParam)) {
        activeYear = yearParam;
      } else {
        activeYear = years[0];
      }
      
      // Render components for selected year
      renderDashboardForYear(activeYear);

      // Check for rate-limiting warning
      const rateLimitWarning = document.getElementById('rate-limit-warning');
      if (rateLimitWarning) {
        if (data.githubStats && data.githubStats.rateLimited) {
          rateLimitWarning.classList.remove('hidden');
        } else {
          rateLimitWarning.classList.add('hidden');
        }
      }

      // Make sure GitHub sections are visible
      const githubSections = Array.from(dashboardContent.querySelectorAll('.profile-card, .grid-section, .metrics-row, .analysis-section'))
        .filter(s => !leetcodeDashboard || !leetcodeDashboard.contains(s));
      githubSections.forEach(s => s.classList.remove('hidden'));

      // Hide Loader, Display Dashboard
      loaderContent.classList.add('hidden');
      dashboardContent.classList.remove('hidden');
      
    } catch (err) {
      console.error(err);
      loaderContent.classList.add('hidden');
      errorText.textContent = err.message || 'An error occurred while retrieving user contributions.';
      errorMessage.classList.remove('hidden');
    } finally {
      searchSubmitBtn.disabled = false;
      searchSubmitBtn.querySelector('span').textContent = 'Analyze Pulse';
    }
  }

  // Fallback helper to fetch profile details (like display name) from public Github API
  async function fetchGithubDisplayName(username) {
    try {
      const res = await fetch(`https://api.github.com/users/${username}`);
      if (res.ok) {
        const profile = await res.json();
        userName.textContent = profile.name || username;
      } else {
        userName.textContent = username;
      }
    } catch (e) {
      userName.textContent = username;
    }
  }

  // --- Render Year Navigation ---
  function renderYearTabs(years) {
    yearTabs.innerHTML = '';
    years.forEach(year => {
      const btn = document.createElement('button');
      btn.className = `year-tab-btn ${year === activeYear ? 'active' : ''}`;
      btn.id = `year-tab-${year}`;
      btn.textContent = year;
      btn.addEventListener('click', () => {
        // Toggle active tabs
        document.querySelectorAll('.year-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeYear = year;
        renderDashboardForYear(year);
      });
      yearTabs.appendChild(btn);
    });
  }

  // --- Render Dashboard Content for Selected Year ---
  function renderDashboardForYear(year) {
    // 1. Filter contributions for selected year
    const yearContributions = appData.contributions.filter(c => c.date.startsWith(`${year}-`));
    
    // Sort chronologically just in case
    yearContributions.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 2. Render Graph Grid
    renderContributionGrid(year, yearContributions);

    // 3. Calculate and Render Metrics
    renderAnalytics(year, yearContributions);
  }

  // --- Compile and Render Contribution Grid ---
  function renderContributionGrid(year, contributions) {
    contributionsGrid.innerHTML = '';
    
    if (contributions.length === 0) return;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Group contributions by month
    const monthlyGroups = Array(12).fill(null).map(() => []);
    
    contributions.forEach(day => {
      const parts = day.date.split('-');
      const monthIdx = parseInt(parts[1], 10) - 1; // 0-indexed
      if (monthIdx >= 0 && monthIdx < 12) {
        monthlyGroups[monthIdx].push(day);
      }
    });

    // Render each month group
    monthlyGroups.forEach((monthDays, monthIdx) => {
      if (monthDays.length === 0) return;

      // Create month container
      const monthContainer = document.createElement('div');
      monthContainer.className = 'month-container';

      // Create month header
      const monthHeader = document.createElement('div');
      monthHeader.className = 'month-header';
      monthHeader.textContent = monthNames[monthIdx];
      monthContainer.appendChild(monthHeader);

      // Create month grid
      const monthGrid = document.createElement('div');
      monthGrid.className = 'month-grid';

      // Find day-of-week offset for first day of month (UTC to avoid local shift)
      const firstDateUTC = new Date(monthDays[0].date + 'T00:00:00Z');
      const startOffset = firstDateUTC.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

      // Find day-of-week offset for last day of month
      const lastDateUTC = new Date(monthDays[monthDays.length - 1].date + 'T00:00:00Z');
      const endOffset = 6 - lastDateUTC.getUTCDay();

      // Prepend empty cells
      for (let i = 0; i < startOffset; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'grid-cell empty-cell';
        placeholder.style.opacity = '0';
        monthGrid.appendChild(placeholder);
      }

      // Add actual contribution days
      monthDays.forEach(day => {
        const cell = document.createElement('div');
        cell.className = `grid-cell level-${day.level}`;
        cell.setAttribute('data-date', day.date);
        cell.setAttribute('data-count', day.count);

        cell.addEventListener('mouseenter', (e) => showTooltip(e, day.count, day.date));
        cell.addEventListener('mouseleave', hideTooltip);

        monthGrid.appendChild(cell);
      });

      // Append empty cells to finish last column
      for (let i = 0; i < endOffset; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'grid-cell empty-cell';
        placeholder.style.opacity = '0';
        monthGrid.appendChild(placeholder);
      }

      monthContainer.appendChild(monthGrid);
      contributionsGrid.appendChild(monthContainer);
    });

    // Update Year Activities Text
    const totalCount = appData.total[year] || 0;
    gridActivitySummary.textContent = `${totalCount.toLocaleString()} activities in ${year}`;
  }

  // --- Display Tooltip ---
  function showTooltip(event, count, dateStr) {
    const rect = event.target.getBoundingClientRect();
    
    // Format count text
    let countText;
    if (activePlatform === 'leetcode') {
      countText = count === 1 ? '1 question solved' : `${count} questions solved`;
    } else {
      countText = count === 1 ? '1 contribution' : `${count} contributions`;
    }
    
    // Format date text: e.g. "May 7, 2026"
    const dateObj = new Date(dateStr);
    const options = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
    const formattedDate = dateObj.toLocaleDateString('en-US', options);

    // Update Tooltip Content
    tooltipCount.textContent = countText;
    tooltipDate.textContent = formattedDate;

    // Position Tooltip above the hovered cell
    tooltip.classList.remove('hidden');
    
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    
    // Calculate page position
    const top = window.scrollY + rect.top - tooltipHeight - 8;
    const left = window.scrollX + rect.left + (rect.width / 2) - (tooltipWidth / 2);

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.classList.add('visible');
  }

  // --- Hide Tooltip ---
  function hideTooltip() {
    tooltip.classList.remove('visible');
    tooltip.classList.add('hidden');
  }

  // --- Calculate Streaks & Visual Analytics ---
  function renderAnalytics(year, contributions) {
    const totalDays = contributions.length;
    if (totalDays === 0) return;

    // 1. Total Contributions
    const totalContributions = appData.total[year] || 0;
    statTotal.textContent = totalContributions.toLocaleString();
    statTotalPeriod.textContent = `Activity in ${year}`;

    // 2. Streaks Calculation (Calculated across all historical data for accuracy)
    const streakData = calculateStreaks(appData.contributions);
    
    // Render Longest Streak
    statLongestStreak.textContent = `${streakData.longestStreak} days`;
    if (streakData.longestStreak > 0) {
      statLongestStreakRange.textContent = `${formatDateRange(streakData.longestStart, streakData.longestEnd)}`;
    } else {
      statLongestStreakRange.textContent = 'No active records';
    }

    // Render Current Streak
    statCurrentStreak.textContent = `${streakData.currentStreak} days`;
    if (streakData.currentStreak > 0) {
      statCurrentStreakRange.textContent = `${formatDateRange(streakData.currentStart, streakData.currentEnd)}`;
    } else {
      statCurrentStreakRange.textContent = 'No active streak';
    }

    // 3. Active Days Ratio
    const activeDays = contributions.filter(c => c.count > 0);
    const activeCount = activeDays.length;
    const ratio = totalDays > 0 ? ((activeCount / totalDays) * 100).toFixed(1) : 0;
    
    statActiveRatio.textContent = `${ratio}%`;
    statActiveDaysCount.textContent = `${activeCount} of ${totalDays} active days`;

    // 4. Daily Average
    const dailyAvg = totalDays > 0 ? (totalContributions / totalDays).toFixed(2) : '0.00';
    insightDailyAvg.textContent = `${dailyAvg} contributions / day`;

    // 5. Peak Activity Day
    let peakDay = { count: 0, date: '-' };
    contributions.forEach(c => {
      if (c.count > peakDay.count) {
        peakDay = { count: c.count, date: c.date };
      }
    });

    if (peakDay.count > 0) {
      const peakDateFormatted = new Date(peakDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      insightPeakDay.textContent = `${peakDay.count} contributions on ${peakDateFormatted}`;
    } else {
      insightPeakDay.textContent = '0 contributions';
    }

    // 6. Day of Week Breakdown
    renderDayOfWeekChart(contributions);

    // 7. Monthly Breakdown
    renderMonthlyChart(contributions);
  }

  // --- Streak Calculator ---
  function calculateStreaks(allContributions) {
    // Make sure contributions are sorted chronologically
    const sorted = [...allContributions].sort((a, b) => new Date(a.date) - new Date(b.date));

    let longestStreak = 0;
    let longestStart = null;
    let longestEnd = null;

    let tempStreak = 0;
    let tempStart = null;

    // Calculate all-time longest streak
    for (let i = 0; i < sorted.length; i++) {
      const day = sorted[i];
      if (day.count > 0) {
        if (tempStreak === 0) {
          tempStart = day.date;
        }
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

    // Calculate current streak tracing backwards from today
    // Skip future dates
    const localToday = new Date();
    // Convert to YYYY-MM-DD in local time
    const year = localToday.getFullYear();
    const month = String(localToday.getMonth() + 1).padStart(2, '0');
    const day = String(localToday.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
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
      
      // Streak is active if user contributed today
      if (lastDay.count > 0) {
        isStreakActive = true;
      } 
      // If user has not contributed today, check if yesterday was active
      else if (lastIndex > 0) {
        const yesterdayDay = sorted[lastIndex - 1];
        if (yesterdayDay.count > 0) {
          // Check if yesterday is actually yesterday (date difference <= 1 day)
          const diffTime = Math.abs(new Date(lastDay.date) - new Date(yesterdayDay.date));
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays <= 1) {
            isStreakActive = true;
            lastIndex = lastIndex - 1; // start tracing back from yesterday
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
        
        // Safety check to ensure days are consecutive (in case of missing data rows)
        if (j > 0) {
          const d1 = new Date(sorted[j].date);
          const d2 = new Date(sorted[j - 1].date);
          const diffTime = Math.abs(d1 - d2);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays > 1) {
            // Gap detected! Break streak
            break;
          }
        }
        j--;
      }
    }

    return {
      currentStreak: currentStreakCount,
      currentStart: currentStart,
      currentEnd: currentEnd,
      longestStreak: longestStreak,
      longestStart: longestStart,
      longestEnd: longestEnd
    };
  }

  // Helper: Format date ranges for streaks
  function formatDateRange(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return '';
    
    const options = { month: 'short', day: 'numeric' };
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    
    const startFormatted = start.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
    
    // Include year if start and end are in different years
    const startYear = start.getUTCFullYear();
    const endYear = end.getUTCFullYear();
    
    if (startYear !== endYear) {
      return `${startFormatted}, ${startYear} - ${end.toLocaleDateString('en-US', { ...options, year: 'numeric', timeZone: 'UTC' })}`;
    }
    
    const endFormatted = end.toLocaleDateString('en-US', { ...options, year: 'numeric', timeZone: 'UTC' });
    return `${startFormatted} - ${endFormatted}`;
  }

  // --- Render Day of Week Chart ---
  function renderDayOfWeekChart(contributions) {
    weeklyChart.innerHTML = '';
    
    // Index: 0=Sun, 1=Mon, ..., 6=Sat
    const daysData = Array(7).fill(0);
    const daysName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    contributions.forEach(c => {
      const dayIdx = new Date(c.date).getDay();
      daysData[dayIdx] += c.count;
    });

    const maxCount = Math.max(...daysData, 1); // Avoid division by zero

    daysData.forEach((count, idx) => {
      const percent = (count / maxCount) * 100;
      
      const barContainer = document.createElement('div');
      barContainer.className = 'chart-bar-container';
      
      barContainer.innerHTML = `
        <div class="chart-bar-value">${count}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="height: 0%"></div>
        </div>
        <span class="chart-bar-label">${daysName[idx]}</span>
      `;
      
      weeklyChart.appendChild(barContainer);
      
      // Trigger animations on reflow
      setTimeout(() => {
        const fill = barContainer.querySelector('.chart-bar-fill');
        if (fill) fill.style.height = `${percent}%`;
      }, 50);
    });
  }

  // --- Render Monthly Chart ---
  function renderMonthlyChart(contributions) {
    monthlyChart.innerHTML = '';
    
    const monthsData = Array(12).fill(0);
    const monthsName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsDaysCount = Array(12).fill(0);
    const monthsActiveDaysCount = Array(12).fill(0);

    contributions.forEach(c => {
      const monthIdx = new Date(c.date).getMonth();
      monthsData[monthIdx] += c.count;
      monthsDaysCount[monthIdx]++;
      if (c.count > 0) {
        monthsActiveDaysCount[monthIdx]++;
      }
    });

    const maxCount = Math.max(...monthsData, 1);

    // Calculate Consistency Month (highest active days ratio)
    let highestConsistency = { ratio: -1, month: '-' };
    monthsData.forEach((count, idx) => {
      if (monthsDaysCount[idx] > 0) {
        const activeRatio = monthsActiveDaysCount[idx] / monthsDaysCount[idx];
        if (activeRatio > highestConsistency.ratio && count > 0) {
          highestConsistency = { ratio: activeRatio, month: monthsName[idx] };
        }
      }
    });

    if (highestConsistency.ratio > 0) {
      insightConsistencyMonth.textContent = `${highestConsistency.month} (${(highestConsistency.ratio * 100).toFixed(0)}% active days)`;
    } else {
      insightConsistencyMonth.textContent = 'No data available';
    }

    // Render monthly bars
    monthsData.forEach((count, idx) => {
      const percent = (count / maxCount) * 100;
      
      const barContainer = document.createElement('div');
      barContainer.className = 'chart-bar-container';
      
      barContainer.innerHTML = `
        <div class="chart-bar-value">${count}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="height: 0%"></div>
        </div>
        <span class="chart-bar-label">${monthsName[idx]}</span>
      `;
      
      monthlyChart.appendChild(barContainer);
      
      // Trigger animations
      setTimeout(() => {
        const fill = barContainer.querySelector('.chart-bar-fill');
        if (fill) fill.style.height = `${percent}%`;
      }, 50);
    });
  }

  // --- Share & Embed Modal Controls ---
  const shareProfileBtn = document.getElementById('share-profile-btn');
  const shareModal = document.getElementById('share-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');

  function populateShareInputs() {
    const currentUsername = userUsername.textContent || 'Demo-For-Test';
    
    const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';

    const origin = window.location.origin;
    
    // 1. Share URL
    const shareUrl = `${origin}/?user=${currentUsername}&theme=${currentTheme}`;
    document.getElementById('share-url-input').value = shareUrl;

    // 2. README Markdown
    const badgeUrl = `${origin}/api/svg/${currentUsername}?theme=${currentTheme}`;
    const dashboardUrl = `${origin}/?user=${currentUsername}`;
    const markdownCode = `[![@${currentUsername}'s GitHub Pulse](${badgeUrl})](${dashboardUrl})`;
    document.getElementById('readme-markdown-input').value = markdownCode;

    // 3. Iframe Code
    const iframeCode = `<iframe src="${origin}/?user=${currentUsername}&theme=${currentTheme}&embed=true" width="100%" height="280" frameborder="0" style="border:none; background:transparent;"></iframe>`;
    document.getElementById('iframe-code-input').value = iframeCode;
  }

  if (shareProfileBtn) {
    shareProfileBtn.addEventListener('click', () => {
      populateShareInputs();
      shareModal.classList.remove('hidden');
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      shareModal.classList.add('hidden');
    });
  }

  if (shareModal) {
    shareModal.addEventListener('click', (e) => {
      if (e.target === shareModal) {
        shareModal.classList.add('hidden');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shareModal && !shareModal.classList.contains('hidden')) {
      shareModal.classList.add('hidden');
    }
  });

  // Copy buttons click listener
  const copyButtons = document.querySelectorAll('.copy-btn');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const inputEl = document.getElementById(targetId);
      if (inputEl) {
        navigator.clipboard.writeText(inputEl.value).then(() => {
          const btnText = btn.querySelector('.copy-btn-text');
          const btnIcon = btn.querySelector('i');
          const originalText = btnText.textContent;
          
          btnText.textContent = 'Copied!';
          btn.classList.add('copied');
          btnIcon.className = 'fa-solid fa-check';
          
          setTimeout(() => {
            btnText.textContent = originalText;
            btn.classList.remove('copied');
            btnIcon.className = 'fa-solid fa-copy';
          }, 2000);
        }).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      }
    });
  });

  // --- Toast Notification Helper ---
  const toastContainer = document.getElementById('toast-container');
  
  function showToast(message) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <i class="fa-solid fa-circle-check toast-icon"></i>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    
    // Trigger transition
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove toast after 3 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // --- Click-to-Copy for All 11 Cards ---
  const cards = document.querySelectorAll('[data-card-id]');
  cards.forEach(card => {
    card.addEventListener('click', (e) => {
      // Prevent copying if clicking on an interactive link inside the card (if any exist)
      if (e.target.closest('a') || e.target.closest('button')) {
        return;
      }

      const cardId = card.getAttribute('data-card-id');
      const currentUsername = userUsername.textContent || 'Demo-For-Test';
      const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
      const currentYear = activeYear || new Date().getFullYear();
      
      const origin = window.location.origin;
      const badgeUrl = `${origin}/api/svg/${currentUsername}/card/${cardId}?theme=${currentTheme}&year=${currentYear}`;
      const dashboardUrl = `${origin}/?user=${currentUsername}&year=${currentYear}`;
      
      // Get human readable card title for toast message
      const cardTitleEl = card.querySelector('.metric-label') || card.querySelector('.card-header h3');
      const cardTitle = cardTitleEl ? cardTitleEl.textContent.trim() : 'Card Embed Badge';
      
      // Generate Markdown Badge Link
      const markdownCode = `[![@${currentUsername}'s ${cardTitle}](${badgeUrl})](${dashboardUrl})`;
      
      navigator.clipboard.writeText(markdownCode).then(() => {
        showToast(`Copied Markdown Badge for "${cardTitle}"!`);
      }).catch(err => {
        console.error('Failed to copy card link: ', err);
        showToast('Failed to copy to clipboard.');
      });
    });
  });

  // --- Click-to-Copy for LeetCode Cards ---
  const lcCards = document.querySelectorAll('[data-lc-card-id]');
  lcCards.forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a') || e.target.closest('button')) {
        return;
      }

      const username = document.getElementById('lc-user-username').textContent.trim();
      if (!username || username === '-') {
        return;
      }

      const cardId = card.getAttribute('data-lc-card-id');
      const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
      const selectedYear = lcActiveYear || new Date().getFullYear();
      
      const origin = window.location.origin;
      const badgeUrl = `${origin}/api/leetcode/svg/${username}/card/${cardId}?theme=${currentTheme}&year=${selectedYear}`;
      const dashboardUrl = `${origin}/?user=${username}&platform=leetcode&year=${selectedYear}`;
      
      // Get human readable card title for toast message
      const cardTitleEl = card.querySelector('.metric-label') || card.querySelector('.card-header h3');
      const cardTitle = cardTitleEl ? cardTitleEl.textContent.trim() : 'LeetCode Card';
      
      // Generate Markdown Badge Link
      const markdownCode = `[![@${username}'s ${cardTitle}](${badgeUrl})](${dashboardUrl})`;
      
      navigator.clipboard.writeText(markdownCode).then(() => {
        showToast(`Copied Markdown Badge for "${cardTitle}"!`);
      }).catch(err => {
        console.error('Failed to copy card link: ', err);
        showToast('Failed to copy to clipboard.');
      });
    });
  });


// ==========================================================================
//   LeetCode Integration
// ==========================================================================

async function fetchLeetCodeData(username) {
  // Show loading, hide others
  splashContent.classList.add('hidden');
  errorMessage.classList.add('hidden');
  dashboardContent.classList.add('hidden');
  loaderContent.classList.remove('hidden');
  searchSubmitBtn.disabled = true;
  searchSubmitBtn.querySelector('span').textContent = 'Analyzing...';

  try {
    const localUrlParams = new URLSearchParams(window.location.search);
    const yearParam = localUrlParams.get('year');
    const fetchUrl = yearParam ? `/api/leetcode/${username}?year=${yearParam}` : `/api/leetcode/${username}`;
    
    const response = await fetch(fetchUrl, { cache: 'no-cache' });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch LeetCode data for: ${username}`);
    }

    const data = await response.json();
    lcData = data;

    // Hide GitHub sections, show LeetCode dashboard
    const githubSections = Array.from(dashboardContent.querySelectorAll('.profile-card, .grid-section, .metrics-row, .analysis-section, #rate-limit-warning'))
      .filter(s => !leetcodeDashboard || !leetcodeDashboard.contains(s));
    githubSections.forEach(s => s.classList.add('hidden'));

    // Show LeetCode dashboard
    if (leetcodeDashboard) {
      leetcodeDashboard.classList.remove('hidden');
    }

    renderLeetCodeDashboard(data, username);

    loaderContent.classList.add('hidden');
    dashboardContent.classList.remove('hidden');

  } catch (err) {
    console.error(err);
    loaderContent.classList.add('hidden');
    errorText.textContent = err.message || 'An error occurred while retrieving LeetCode data.';
    errorMessage.classList.remove('hidden');
  } finally {
    searchSubmitBtn.disabled = false;
    searchSubmitBtn.querySelector('span').textContent = 'Analyze Pulse';
  }
}

function renderLeetCodeDashboard(data, username) {
  // Profile
  const lcAvatar = document.getElementById('lc-user-avatar');
  const lcName = document.getElementById('lc-user-name');
  const lcUsername = document.getElementById('lc-user-username');
  const lcLink = document.getElementById('lc-user-link');

  if (lcAvatar) lcAvatar.src = data.profile?.userAvatar || '';
  if (lcName) lcName.textContent = data.profile?.realName || username;
  if (lcUsername) lcUsername.textContent = username;
  if (lcLink) lcLink.href = `https://leetcode.com/u/${username}/`;

  // Submit stats
  const submissions = data.submissions || {};
  const totalSolved = submissions.totalSolved || 0;
  const totalQuestions = submissions.total || 0;
  const easySolved = submissions.easySolved || 0;
  const easyTotal = submissions.easy || 0;
  const medSolved = submissions.mediumSolved || 0;
  const medTotal = submissions.medium || 0;
  const hardSolved = submissions.hardSolved || 0;
  const hardTotal = submissions.hard || 0;

  document.getElementById('lc-solved-count').textContent = totalSolved;
  document.getElementById('lc-total-count').textContent = `/${totalQuestions}`;
  document.getElementById('lc-easy-count').textContent = `${easySolved}/${easyTotal}`;
  document.getElementById('lc-medium-count').textContent = `${medSolved}/${medTotal}`;
  document.getElementById('lc-hard-count').textContent = `${hardSolved}/${hardTotal}`;

  // Render donut chart
  renderDonutChart(easySolved, medSolved, hardSolved, totalQuestions);

  // Contest
  const contestRating = data.contest?.rating;
  document.getElementById('lc-contest-rating').textContent = contestRating ? Math.round(contestRating).toLocaleString() : '-';
  document.getElementById('lc-global-rank').textContent = data.contest?.globalRanking
    ? `Global Rank: #${data.contest.globalRanking.toLocaleString()}`
    : 'No contest data';

  // Streak
  document.getElementById('lc-max-streak').textContent = `${data.calendar?.streak || 0} days`;

  // Reputation
  document.getElementById('lc-reputation').textContent = (data.profile?.reputation || 0).toLocaleString();
  document.getElementById('lc-ranking').textContent = data.profile?.ranking
    ? `Ranking: #${data.profile.ranking.toLocaleString()}`
    : 'Ranking: -';

  // Views
  document.getElementById('lc-views').textContent = (data.profile?.postViewCount || 0).toLocaleString();

  // Solutions
  document.getElementById('lc-solutions').textContent = (data.profile?.solutionCount || 0).toLocaleString();

  // Set default active year (most recent from available years, or from URL parameter)
  const localUrlParams = new URLSearchParams(window.location.search);
  const yearParam = localUrlParams.get('year');
  const availableYears = data.calendar?.years || [new Date().getFullYear()];
  
  if (yearParam && availableYears.map(String).includes(String(yearParam))) {
    lcActiveYear = parseInt(yearParam, 10);
  } else if (!lcActiveYear || !availableYears.includes(lcActiveYear)) {
    lcActiveYear = availableYears[0];
  }

  // Render year tabs
  renderLeetCodeYearTabs(availableYears);

  // Submission Calendar
  renderLeetCodeCalendar(data.calendar?.submissionCalendar);

}

function renderLeetCodeYearTabs(years) {
  if (!lcYearTabs) return;
  lcYearTabs.innerHTML = '';
  years.forEach(year => {
    const btn = document.createElement('button');
    btn.className = `year-tab-btn ${year === lcActiveYear ? 'active' : ''}`;
    btn.id = `lc-year-tab-${year}`;
    btn.textContent = year;
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#lc-year-tabs .year-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      lcActiveYear = year;
      
      const username = usernameInput.value.trim() || lcData?.username;
      
      // Temporarily dim the grid to show loading state
      const grid = document.getElementById('lc-contributions-grid');
      if (grid) {
        grid.style.opacity = '0.5';
      }

      try {
        const response = await fetch(`/api/leetcode/${username}?year=${year}`);
        if (response.ok) {
          const yearData = await response.json();
          renderLeetCodeCalendar(yearData.calendar?.submissionCalendar);
        }
      } catch (err) {
        console.error('Failed to fetch calendar data for year:', err);
      } finally {
        if (grid) {
          grid.style.opacity = '1';
        }
      }
      
    });
    lcYearTabs.appendChild(btn);
  });
}

function renderDonutChart(easy, med, hard, total) {
  const svg = document.getElementById('lc-donut-chart');
  if (!svg) return;

  const cx = 100, cy = 100, r = 80;
  const circumference = 2 * Math.PI * r;
  const safeDivisor = Math.max(total, 1);

  const easyPct = easy / safeDivisor;
  const medPct = med / safeDivisor;
  const hardPct = hard / safeDivisor;

  // Get theme-aware colors
  const isDark = document.body.classList.contains('theme-dark');
  const trackColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const easyColor = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(31,35,40,0.5)';
  const medColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(31,35,40,0.7)';
  const hardColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(31,35,40,0.9)';

  let offset = 0;

  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="14" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${easyColor}" stroke-width="14"
      stroke-dasharray="${easyPct * circumference} ${circumference}" stroke-dashoffset="${-offset}" stroke-linecap="round" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${medColor}" stroke-width="14"
      stroke-dasharray="${medPct * circumference} ${circumference}" stroke-dashoffset="${-(offset + easyPct * circumference)}" stroke-linecap="round" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${hardColor}" stroke-width="14"
      stroke-dasharray="${hardPct * circumference} ${circumference}" stroke-dashoffset="${-(offset + (easyPct + medPct) * circumference)}" stroke-linecap="round" />
  `;
}

function renderLeetCodeCalendar(calendarJson) {
  const grid = document.getElementById('lc-contributions-grid');
  const summary = document.getElementById('lc-activity-summary');
  if (!grid) return;
  grid.innerHTML = '';

  if (!calendarJson) {
    if (summary) summary.textContent = '0 submissions this year';
    return;
  }

  let calendarData;
  try {
    calendarData = typeof calendarJson === 'string' ? JSON.parse(calendarJson) : calendarJson;
  } catch {
    if (summary) summary.textContent = '0 submissions this year';
    return;
  }

  // Convert timestamps to date->count map for selected year
  const selectedYear = lcActiveYear || new Date().getFullYear();
  const dateMap = {};
  let totalSubmissions = 0;

  Object.entries(calendarData).forEach(([timestamp, count]) => {
    const date = new Date(parseInt(timestamp) * 1000);
    const year = date.getFullYear();
    if (year === selectedYear) {
      const dateStr = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      dateMap[dateStr] = (dateMap[dateStr] || 0) + count;
      totalSubmissions += count;
    }
  });

  if (summary) summary.textContent = `${totalSubmissions.toLocaleString()} submissions in ${selectedYear}`;

  // Build contributions array
  const contributions = [];
  const startDate = new Date(selectedYear, 0, 1);
  const today = new Date();
  const endDate = new Date(selectedYear, 11, 31);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = dateMap[dateStr] || 0;
    let level = 0;
    if (count >= 10) level = 4;
    else if (count >= 5) level = 3;
    else if (count >= 2) level = 2;
    else if (count >= 1) level = 1;

    contributions.push({ date: dateStr, count, level });
  }

  // Render using the same month-grid pattern as GitHub
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyGroups = Array(12).fill(null).map(() => []);

  contributions.forEach(day => {
    const monthIdx = parseInt(day.date.split('-')[1], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthlyGroups[monthIdx].push(day);
    }
  });

  monthlyGroups.forEach((monthDays, monthIdx) => {
    if (monthDays.length === 0) return;

    const monthContainer = document.createElement('div');
    monthContainer.className = 'month-container';

    const monthHeader = document.createElement('div');
    monthHeader.className = 'month-header';
    monthHeader.textContent = monthNames[monthIdx];
    monthContainer.appendChild(monthHeader);

    const monthGrid = document.createElement('div');
    monthGrid.className = 'month-grid';

    const firstDateUTC = new Date(monthDays[0].date + 'T00:00:00Z');
    const startOffset = firstDateUTC.getUTCDay();
    const lastDateUTC = new Date(monthDays[monthDays.length - 1].date + 'T00:00:00Z');
    const endOffset = 6 - lastDateUTC.getUTCDay();

    for (let i = 0; i < startOffset; i++) {
      const p = document.createElement('div');
      p.className = 'grid-cell empty-cell';
      p.style.opacity = '0';
      monthGrid.appendChild(p);
    }

    monthDays.forEach(day => {
      const cell = document.createElement('div');
      cell.className = `grid-cell level-${day.level}`;
      cell.setAttribute('data-date', day.date);
      cell.setAttribute('data-count', day.count);
      cell.addEventListener('mouseenter', (e) => showTooltip(e, day.count, day.date));
      cell.addEventListener('mouseleave', hideTooltip);
      monthGrid.appendChild(cell);
    });

    for (let i = 0; i < endOffset; i++) {
      const p = document.createElement('div');
      p.className = 'grid-cell empty-cell';
      p.style.opacity = '0';
      monthGrid.appendChild(p);
    }

    monthContainer.appendChild(monthGrid);
    grid.appendChild(monthContainer);
  });
}




  // --- Auto-Load Defaults or URL Params on Launch ---
  const urlParams = new URLSearchParams(window.location.search);
  const userParam = urlParams.get('user') || urlParams.get('username');
  const themeParam = urlParams.get('theme');
  const embedParam = urlParams.get('embed');
  const platformParam = urlParams.get('platform');

  if (embedParam === 'true') {
    document.body.classList.add('is-embedded');
  }

  // Determine starting theme: URL parameter -> localStorage -> default 'dark'
  let startingTheme = 'dark';
  if (themeParam === 'dark' || themeParam === 'light') {
    startingTheme = themeParam;
  } else {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      startingTheme = savedTheme;
    }
  }
  applyTheme(startingTheme);

  if (platformParam === 'leetcode') {
    activePlatform = 'leetcode';
    if (platformSelect) platformSelect.value = 'leetcode';
  }

  if (userParam) {
    usernameInput.value = userParam;
    if (activePlatform === 'leetcode') {
      fetchLeetCodeData(userParam);
    } else {
      fetchContributionData(userParam);
    }
  } else {
    fetchContributionData('Demo-For-Test');
  }

});
