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
  
  // --- App State ---
  let appData = null;
  let activeYear = null;
  
  // --- Initialize Theme Handler ---
  const themeButtons = document.querySelectorAll('.theme-btn');
  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTheme = btn.getAttribute('data-theme');
      
      // Update active class on buttons
      themeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update body theme class, preserving embedded state
      const isEmbedded = document.body.classList.contains('is-embedded');
      document.body.className = '';
      document.body.classList.add(`theme-${selectedTheme}`);
      if (isEmbedded) {
        document.body.classList.add('is-embedded');
      }
    });
  });

  // --- Form Submission Handler ---
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (username) {
      fetchContributionData(username);
    }
  });

  // --- Fetch Contribution Data ---
  async function fetchContributionData(username) {
    // Show loading state, hide others
    splashContent.classList.add('hidden');
    errorMessage.classList.add('hidden');
    dashboardContent.classList.add('hidden');
    loaderContent.classList.remove('hidden');
    searchSubmitBtn.disabled = true;
    searchSubmitBtn.querySelector('span').textContent = 'Analyzing...';

    try {
      const response = await fetch(`/api/contributions/${username}`);
      
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

      // Set default active year (most recent)
      activeYear = years[0];
      
      // Render components for selected year
      renderDashboardForYear(activeYear);

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
    const countText = count === 1 ? '1 contribution' : `${count} contributions`;
    
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
    
    let currentTheme = 'green';
    const activeThemeBtn = document.querySelector('.theme-btn.active');
    if (activeThemeBtn) {
      currentTheme = activeThemeBtn.getAttribute('data-theme');
    }

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

  // --- Auto-Load Defaults or URL Params on Launch ---
  const urlParams = new URLSearchParams(window.location.search);
  const userParam = urlParams.get('user') || urlParams.get('username');
  const themeParam = urlParams.get('theme');
  const embedParam = urlParams.get('embed');

  if (embedParam === 'true') {
    document.body.classList.add('is-embedded');
  }

  if (themeParam) {
    const targetBtn = document.querySelector(`.theme-btn[data-theme="${themeParam}"]`);
    if (targetBtn) {
      targetBtn.click();
    }
  }

  if (userParam) {
    usernameInput.value = userParam;
    fetchContributionData(userParam);
  } else {
    fetchContributionData('Demo-For-Test');
  }

});
