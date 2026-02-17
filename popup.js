// Cookie Lite Editor - Core functionality
// Optimized for Microsoft Edge Manifest V3

// ============= STATE MANAGEMENT =============
let currentDomain = '';
let allCookies = [];
let isModalOpen = false;

// ============= INITIALIZATION =============
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentDomain();
  await loadCookies();
  setupEventListeners();
});

// ============= DOMAIN DETECTION =============
async function loadCurrentDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      currentDomain = url.hostname;
      document.getElementById('current-domain').textContent = currentDomain;
    }
  } catch (error) {
    console.error('Error getting domain:', error);
    document.getElementById('current-domain').textContent = 'Unable to detect';
  }
}

// ============= COOKIE OPERATIONS =============
async function loadCookies() {
  try {
    if (!currentDomain) return;
    
    // Get cookies for current domain and all subdomains
    allCookies = await chrome.cookies.getAll({ domain: currentDomain });
    
    // Also get domain without leading dot for exact matches
    if (currentDomain.startsWith('.')) {
      const exactCookies = await chrome.cookies.getAll({ domain: currentDomain.substring(1) });
      allCookies = [...allCookies, ...exactCookies];
    } else {
      const dotCookies = await chrome.cookies.getAll({ domain: '.' + currentDomain });
      allCookies = [...allCookies, ...dotCookies];
    }
    
    // Remove duplicates (same name, domain, path)
    allCookies = removeDuplicateCookies(allCookies);
    
    // Sort by name
    allCookies.sort((a, b) => a.name.localeCompare(b.name));
    
    renderCookieTable();
  } catch (error) {
    showStatus('Failed to load cookies: ' + error.message, 'error');
  }
}

function removeDuplicateCookies(cookies) {
  const seen = new Set();
  return cookies.filter(cookie => {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderCookieTable() {
  const tbody = document.getElementById('cookie-list');
  
  if (allCookies.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No cookies found for this domain</td></tr>';
    return;
  }
  
  tbody.innerHTML = allCookies.map(cookie => `
    <tr>
      <td title="${escapeHtml(cookie.name)}">${escapeHtml(truncate(cookie.name, 20))}</td>
      <td title="${escapeHtml(cookie.value)}">${escapeHtml(truncate(cookie.value, 30))}</td>
      <td>${escapeHtml(cookie.domain || '')}</td>
      <td>${escapeHtml(cookie.path || '/')}</td>
      <td>${cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleDateString() : 'Session'}</td>
      <td>${cookie.secure ? '✅' : '❌'}</td>
      <td>${cookie.httpOnly ? '✅' : '❌'}</td>
      <td>${formatSameSite(cookie.sameSite)}</td>
      <td>
        <button class="edit-btn" data-cookie='${JSON.stringify(cookie).replace(/'/g, "&#39;")}'>✏️</button>
        <button class="delete-btn" data-cookie='${JSON.stringify(cookie).replace(/'/g, "&#39;")}'>🗑️</button>
      </td>
    </tr>
  `).join('');
  
  // Attach event listeners to new buttons
  attachCookieButtonListeners();
}

// ============= COOKIE CRUD OPERATIONS =============

// Create/Update Cookie
async function saveCookie(cookieData) {
  try {
    // Prepare cookie object for chrome.cookies.set
    const cookie = {
      url: `http${cookieData.secure ? 's' : ''}://${cookieData.domain.replace(/^\./, '')}${cookieData.path}`,
      name: cookieData.name,
      value: cookieData.value || '',
      domain: cookieData.domain,
      path: cookieData.path || '/',
      secure: cookieData.secure || false,
      sameSite: cookieData.sameSite || 'unspecified'
    };
    
    // Add expiration if provided
    if (cookieData.expires) {
      const expiryDate = new Date(cookieData.expires);
      if (!isNaN(expiryDate.getTime())) {
        cookie.expirationDate = Math.floor(expiryDate.getTime() / 1000);
      }
    }
    
    // For updates, we need to delete the old cookie first if identifying fields changed
    if (cookieData.originalName && 
        (cookieData.originalName !== cookieData.name || 
         cookieData.originalDomain !== cookieData.domain || 
         cookieData.originalPath !== cookieData.path)) {
      
      await chrome.cookies.remove({
        url: `http${cookieData.secure ? 's' : ''}://${cookieData.originalDomain.replace(/^\./, '')}${cookieData.originalPath}`,
        name: cookieData.originalName
      });
    }
    
    // Set the cookie
    const result = await chrome.cookies.set(cookie);
    
    if (result) {
      showStatus('Cookie saved successfully!', 'success');
      await loadCookies(); // Refresh the list
      closeModal();
    }
  } catch (error) {
    showStatus('Error saving cookie: ' + error.message, 'error');
  }
}

// Delete Cookie
async function deleteCookie(cookieData) {
  try {
    const protocol = cookieData.secure ? 'https:' : 'http:';
    const domain = cookieData.domain.replace(/^\./, '');
    const url = `${protocol}//${domain}${cookieData.path || '/'}`;
    
    await chrome.cookies.remove({
      url: url,
      name: cookieData.name
    });
    
    showStatus('Cookie deleted successfully!', 'success');
    await loadCookies();
    closeModal();
  } catch (error) {
    showStatus('Error deleting cookie: ' + error.message, 'error');
  }
}

// ============= IMPORT / EXPORT =============
function exportCookies() {
  try {
    if (allCookies.length === 0) {
      showStatus('No cookies to export', 'error');
      return;
    }
    
    const exportData = {
      domain: currentDomain,
      exportDate: new Date().toISOString(),
      cookies: allCookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.expirationDate
      }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
      url: url,
      filename: `cookies-${currentDomain}-${new Date().getTime()}.json`,
      saveAs: true
    });
    
    showStatus('Cookies exported successfully!', 'success');
  } catch (error) {
    showStatus('Export failed: ' + error.message, 'error');
  }
}

function importCookies() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  
  input.onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      if (!importData.cookies || !Array.isArray(importData.cookies)) {
        throw new Error('Invalid cookie file format');
      }
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const cookieData of importData.cookies) {
        try {
          // Ensure cookie has required fields
          const cookie = {
            url: `http${cookieData.secure ? 's' : ''}://${cookieData.domain.replace(/^\./, '')}${cookieData.path || '/'}`,
            name: cookieData.name,
            value: cookieData.value || '',
            domain: cookieData.domain,
            path: cookieData.path || '/',
            secure: cookieData.secure || false,
            httpOnly: cookieData.httpOnly || false,
            sameSite: cookieData.sameSite || 'unspecified'
          };
          
          if (cookieData.expirationDate) {
            cookie.expirationDate = cookieData.expirationDate;
          }
          
          await chrome.cookies.set(cookie);
          successCount++;
        } catch (err) {
          console.error('Failed to import cookie:', cookieData.name, err);
          errorCount++;
        }
      }
      
      showStatus(`Import complete: ${successCount} succeeded, ${errorCount} failed`, 
                 errorCount === 0 ? 'success' : 'error');
      
      await loadCookies(); // Refresh the list
    } catch (error) {
      showStatus('Import failed: ' + error.message, 'error');
    }
  };
  
  input.click();
}

// ============= MODAL MANAGEMENT =============
function openCreateModal() {
  document.getElementById('modal-title').textContent = 'New Cookie';
  document.getElementById('edit-original-name').value = '';
  document.getElementById('edit-original-domain').value = '';
  document.getElementById('edit-original-path').value = '';
  document.getElementById('edit-name').value = '';
  document.getElementById('edit-value').value = '';
  document.getElementById('edit-domain').value = currentDomain;
  document.getElementById('edit-path').value = '/';
  document.getElementById('edit-expires').value = '';
  document.getElementById('edit-samesite').value = 'unspecified';
  document.getElementById('edit-secure').checked = false;
  document.getElementById('edit-httponly').checked = false;
  document.getElementById('delete-cookie-btn').style.display = 'none';
  
  openModal();
}

function openEditModal(cookie) {
  document.getElementById('modal-title').textContent = 'Edit Cookie';
  document.getElementById('edit-original-name').value = cookie.name;
  document.getElementById('edit-original-domain').value = cookie.domain || '';
  document.getElementById('edit-original-path').value = cookie.path || '/';
  document.getElementById('edit-name').value = cookie.name;
  document.getElementById('edit-value').value = cookie.value || '';
  document.getElementById('edit-domain').value = cookie.domain || '';
  document.getElementById('edit-path').value = cookie.path || '/';
  
  // Set expiration date if exists
  if (cookie.expirationDate) {
    const date = new Date(cookie.expirationDate * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    document.getElementById('edit-expires').value = `${year}-${month}-${day}T${hours}:${minutes}`;
  } else {
    document.getElementById('edit-expires').value = '';
  }
  
  document.getElementById('edit-samesite').value = cookie.sameSite || 'unspecified';
  document.getElementById('edit-secure').checked = cookie.secure || false;
  document.getElementById('edit-httponly').checked = cookie.httpOnly || false;
  document.getElementById('delete-cookie-btn').style.display = 'block';
  
  // Store current cookie data for delete operation
  document.getElementById('delete-cookie-btn').setAttribute('data-cookie', JSON.stringify(cookie));
  
  openModal();
}

function openModal() {
  document.getElementById('cookie-modal').style.display = 'flex';
  isModalOpen = true;
}

function closeModal() {
  document.getElementById('cookie-modal').style.display = 'none';
  isModalOpen = false;
}

// ============= UTILITY FUNCTIONS =============
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(str, length) {
  if (!str) return '';
  return str.length > length ? str.substring(0, length) + '...' : str;
}

function formatSameSite(sameSite) {
  const formats = {
    'no_restriction': 'None',
    'lax': 'Lax',
    'strict': 'Strict',
    'unspecified': 'Default'
  };
  return formats[sameSite] || sameSite || 'Default';
}

function showStatus(message, type) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

// ============= EVENT LISTENERS =============
function setupEventListeners() {
  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', loadCookies);
  
  // Add button
  document.getElementById('add-btn').addEventListener('click', openCreateModal);
  
  // Export button
  document.getElementById('export-btn').addEventListener('click', exportCookies);
  
  // Import button
  document.getElementById('import-btn').addEventListener('click', importCookies);
  
  // Modal close
  document.querySelector('.close').addEventListener('click', closeModal);
  document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
  
  // Save cookie form
  document.getElementById('cookie-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const cookieData = {
      name: document.getElementById('edit-name').value.trim(),
      value: document.getElementById('edit-value').value,
      domain: document.getElementById('edit-domain').value.trim(),
      path: document.getElementById('edit-path').value.trim() || '/',
      secure: document.getElementById('edit-secure').checked,
      sameSite: document.getElementById('edit-samesite').value,
      expires: document.getElementById('edit-expires').value,
      originalName: document.getElementById('edit-original-name').value,
      originalDomain: document.getElementById('edit-original-domain').value,
      originalPath: document.getElementById('edit-original-path').value
    };
    
    // Validate required fields
    if (!cookieData.name) {
      showStatus('Cookie name is required', 'error');
      return;
    }
    
    if (!cookieData.domain) {
      showStatus('Domain is required', 'error');
      return;
    }
    
    await saveCookie(cookieData);
  });
  
  // Delete button in modal
  document.getElementById('delete-cookie-btn').addEventListener('click', async (e) => {
    const cookieJson = e.target.getAttribute('data-cookie');
    if (cookieJson) {
      const cookie = JSON.parse(cookieJson);
      if (confirm(`Are you sure you want to delete cookie "${cookie.name}"?`)) {
        await deleteCookie(cookie);
      }
    }
  });
  
  // Click outside modal to close
  window.addEventListener('click', (e) => {
    if (e.target === document.getElementById('cookie-modal')) {
      closeModal();
    }
  });
}

function attachCookieButtonListeners() {
  // Edit buttons
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cookie = JSON.parse(btn.getAttribute('data-cookie'));
      openEditModal(cookie);
    });
  });
  
  // Delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cookie = JSON.parse(btn.getAttribute('data-cookie'));
      if (confirm(`Are you sure you want to delete cookie "${cookie.name}"?`)) {
        await deleteCookie(cookie);
      }
    });
  });
}