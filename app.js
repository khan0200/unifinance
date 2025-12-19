import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    deleteDoc,
    updateDoc,
    doc,
    onSnapshot,
    query,
    orderBy,
    Timestamp
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAcHgQQ40D7cfWpibj5CZI78eEl9p680Mc",
    authDomain: "unifinance-1b349.firebaseapp.com",
    projectId: "unifinance-1b349",
    storageBucket: "unifinance-1b349.firebasestorage.app",
    messagingSenderId: "1040202736714",
    appId: "1:1040202736714:web:0f5cad32428bca8d1972b3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Global State
let transactions = [];
let cleanupListener = null;
let selectedIds = new Set();
let editingId = null;
let archives = [];
let cleanupArchiveListener = null;

// Currency States
let dashboardCurrency = 'USD';
let incomeCurrency = 'USD';
let outcomeCurrency = 'USD';

// Filter States
const incomeFilters = {
    start: '',
    end: '',
    method: 'All'
};

const outcomeFilters = {
    start: '',
    end: '',
    method: 'All'
};

const archiveFilters = {
    start: '',
    end: '',
    method: 'All',
    type: 'All'
};

let archiveSelectedIds = new Set();

// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    income: document.getElementById('view-income'),
    outcome: document.getElementById('view-outcome'),
    archive: document.getElementById('view-archive')
};

const navLinks = {
    dashboard: document.getElementById('nav-dashboard'),
    income: document.getElementById('nav-income'),
    outcome: document.getElementById('nav-outcome'),
    archive: document.getElementById('nav-archive')
};

const transactionModal = new bootstrap.Modal(document.getElementById('transactionModal'));
const detailsModal = new bootstrap.Modal(document.getElementById('detailsModal'));
const transactionForm = document.getElementById('transactionForm');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Set Date
    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('en-US', options);

    // Set default date in modal
    document.getElementById('date').valueAsDate = new Date();

    // Start Listeners
    listenForTransactions();
    listenForArchives();
});

// Routing
window.route = (viewName) => {
    // Clear selections when navigating
    if (typeof window.clearSelection === 'function') {
        window.clearSelection();
    }

    Object.values(views).forEach(el => el.classList.add('d-none'));
    Object.values(navLinks).forEach(el => el && el.classList.remove('active-nav-link'));

    if (views[viewName]) {
        views[viewName].classList.remove('d-none');
        views[viewName].style.animation = 'none';
        views[viewName].offsetHeight; // Trigger reflow
        views[viewName].style.animation = null;
    }

    if (navLinks[viewName]) navLinks[viewName].classList.add('active-nav-link');
};

window.closeOffcanvas = () => {
    const offcanvasElement = document.getElementById('offcanvasSidebar');
    if (offcanvasElement) {
        const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasElement);
        if (offcanvasInstance) {
            offcanvasInstance.hide();
        }
    }
};

window.openDetailsModal = (id) => {
    const t = transactions.find(tr => tr.id === id);
    if (!t) return;

    const isIncome = t.type === 'income';
    const amountColor = isIncome ? 'text-success' : 'text-danger';
    const iconRx = isIncome ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger';
    const iconClass = isIncome ? 'bi-arrow-down-left' : 'bi-arrow-up-right';

    // Set Data
    document.getElementById('detailType').textContent = isIncome ? 'Income' : 'Outcome';
    document.getElementById('detailAmount').className = `fw-bold mb-0 ${amountColor}`;
    document.getElementById('detailAmount').textContent = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(t.amount);
    document.getElementById('detailCurrency').textContent = t.currency || 'USD';

    // Icon
    const iconContainer = document.getElementById('detailIcon');
    iconContainer.className = `rounded-circle d-inline-flex align-items-center justify-content-center mb-3 ${iconRx}`;
    iconContainer.querySelector('i').className = `bi ${iconClass} fs-2`;

    // Details
    document.getElementById('detailDescription').textContent = t.description;
    document.getElementById('detailDate').textContent = t.date;
    document.getElementById('detailMethod').textContent = t.paymentMethod || 'General';

    detailsModal.show();
};


// Modal Logic
window.openAddModal = (type) => {
    editingId = null; // Reset editing state
    document.getElementById('transactionType').value = type;
    document.getElementById('transactionModalLabel').textContent = `Add ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    transactionForm.reset();
    document.getElementById('date').valueAsDate = new Date();
    // Default currency to USD for simplicity, or last used
    document.getElementById('currency').value = 'USD';
    document.getElementById('saveTransactionBtn').querySelector('.btn-text').textContent = 'Save Transaction';
    transactionModal.show();
};

const amountInput = document.getElementById('amount');
const saveBtn = document.getElementById('saveTransactionBtn');
const saveSpinner = document.getElementById('saveSpinner');
const btnText = saveBtn.querySelector('.btn-text');

amountInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/[^0-9]/g, '');
    if (value) value = parseInt(value, 10).toLocaleString('en-US');
    e.target.value = value;
});

document.querySelectorAll('.glass-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const descArea = document.getElementById('description');
        if (descArea.value.trim() === '') descArea.value = chip.textContent;
        else descArea.value += `, ${chip.textContent}`;
    });
});

transactionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    btnText.classList.add('invisible');
    saveSpinner.classList.remove('d-none');

    const type = document.getElementById('transactionType').value;
    const amount = parseFloat(document.getElementById('amount').value.replace(/,/g, ''));
    const currency = document.getElementById('currency').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const dateVal = document.getElementById('date').value;
    const description = document.getElementById('description').value;

    try {
        if (editingId) {
            // Update
            const docRef = doc(db, "transactions", editingId);
            await updateDoc(docRef, {
                type,
                amount,
                currency,
                paymentMethod,
                date: dateVal,
                description
            });
        } else {
            // Create
            await addDoc(collection(db, "transactions"), {
                type,
                amount,
                currency,
                paymentMethod,
                date: dateVal,
                description,
                createdAt: Timestamp.now()
            });
        }
        transactionModal.hide();
        transactionForm.reset();
        setTimeout(() => {
            saveBtn.disabled = false;
            btnText.classList.remove('invisible');
            saveSpinner.classList.add('d-none');
        }, 500);
    } catch (error) {
        console.error("Error adding document: ", error);
        alert("Error saving transaction");
        saveBtn.disabled = false;
        btnText.classList.remove('invisible');
        saveSpinner.classList.add('d-none');
    }
});

// Currency Switching Logic
window.switchDashboardCurrency = (curr) => {
    dashboardCurrency = curr;
    updateCurrencyToggles('dash', curr);
    updateDashboard();
};

window.switchListCurrency = (type, curr) => {
    if (type === 'income') incomeCurrency = curr;
    if (type === 'outcome') outcomeCurrency = curr;
    updateCurrencyToggles(type, curr);
    updateViewStats(); // Update stats when currency changes
    renderLists();
};

function updateCurrencyToggles(prefix, curr) {
    const btnUSD = document.getElementById(`${prefix}-btn-usd`);
    const btnUZS = document.getElementById(`${prefix}-btn-uzs`);

    if (curr === 'USD') {
        btnUSD.classList.remove('text-secondary');
        btnUSD.classList.add('btn-light', 'shadow-sm');

        btnUZS.classList.remove('btn-light', 'shadow-sm');
        btnUZS.classList.add('text-secondary');
    } else {
        btnUZS.classList.remove('text-secondary');
        btnUZS.classList.add('btn-light', 'shadow-sm');

        btnUSD.classList.remove('btn-light', 'shadow-sm');
        btnUSD.classList.add('text-secondary');
    }
}

// Real-time Listener
function listenForTransactions() {
    const q = query(collection(db, "transactions"), orderBy("date", "desc"));
    cleanupListener = onSnapshot(q, (snapshot) => {
        transactions = [];
        snapshot.forEach((doc) => transactions.push({
            id: doc.id,
            ...doc.data()
        }));
        updateDashboard();
        updateViewStats();
        renderLists();
    });
}

function updateDashboard() {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Dashboard Overview Stats (Sensitive to selected dashboardCurrency)
    let todayIncome = 0,
        todayOutcome = 0,
        monthIncome = 0,
        monthOutcome = 0;

    // Global Balance Stats (Calculated regardless of dashboard view)
    let balanceUSD = 0;
    let balanceUZS = 0;

    transactions.forEach(t => {
        const val = parseFloat(t.amount);
        const curr = t.currency || 'USD';

        // 1. Calculate Global Balance (All time)
        if (t.type === 'income') {
            if (curr === 'USD') balanceUSD += val;
            else balanceUZS += val;
        } else {
            if (curr === 'USD') balanceUSD -= val;
            else balanceUZS -= val;
        }

        // 2. Calculate Dashboard Specific Stats (Today/Month)
        if (curr === dashboardCurrency) {
            if (t.type === 'income') {
                if (t.date === today) todayIncome += val;
                if (t.date.startsWith(currentMonth)) monthIncome += val;
            } else {
                if (t.date === today) todayOutcome += val;
                if (t.date.startsWith(currentMonth)) monthOutcome += val;
            }
        }
    });

    // Formatter Helpers
    const fmtCurr = (amt, curr) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: curr,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amt);

    const fmtDash = (amt) => fmtCurr(amt, dashboardCurrency);

    // Update Dashboard Cards
    document.getElementById('summary-today-income').textContent = fmtDash(todayIncome);
    document.getElementById('summary-today-outcome').textContent = fmtDash(todayOutcome);
    document.getElementById('summary-month-income').textContent = fmtDash(monthIncome);
    document.getElementById('summary-month-outcome').textContent = fmtDash(monthOutcome);

    // Update Balances by Payment Method
    updateBalancesByPaymentMethod();
}

function updateBalancesByPaymentMethod() {
    // Payment methods map for display
    const paymentMethodsDisplay = {
        'Cash': 'NAQD',
        'Karta M.A': 'Karta M.A',
        'Karta J.A': 'Karta J.A',
        'Bank': 'Bank',
        'Other': 'Other'
    };

    // Calculate balances by payment method for each currency
    const balancesByMethod = {};

    transactions.forEach(t => {
        const method = t.paymentMethod || 'Cash';
        const curr = t.currency || 'USD';
        const val = parseFloat(t.amount);

        if (!balancesByMethod[method]) {
            balancesByMethod[method] = {
                USD: 0,
                UZS: 0
            };
        }

        if (t.type === 'income') {
            balancesByMethod[method][curr] += val;
        } else {
            balancesByMethod[method][curr] -= val;
        }
    });

    // Format currencies
    const fmt = (amt, curr) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: curr,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amt);

    // Build HTML for balance display
    const container = document.getElementById('balance-by-method-container');
    const balanceElements = [];

    // Iterate through payment methods in order
    const methodsOrder = ['Cash', 'Karta M.A', 'Karta J.A', 'Bank', 'Other'];

    methodsOrder.forEach(method => {
        if (balancesByMethod[method]) {
            const balUSD = balancesByMethod[method].USD;
            const balUZS = balancesByMethod[method].UZS;

            // Display method if it has any balance
            if (balUSD !== 0 || balUZS !== 0) {
                const displayName = paymentMethodsDisplay[method];
                let balanceText = '';

                if (balUSD !== 0) balanceText += `${fmt(balUSD, 'USD')}`;
                if (balUZS !== 0) {
                    if (balanceText) balanceText += ' | ';
                    balanceText += `${fmt(balUZS, 'UZS')}`;
                }

                balanceElements.push(`<div class="badge bg-primary text-white px-3 py-2 fw-bold"><strong>${displayName}:</strong> ${balanceText}</div>`);
            }
        }
    });

    // If no balances, show zero message
    if (balanceElements.length === 0) {
        container.innerHTML = '<div class="text-muted small">No transactions yet</div>';
    } else {
        container.innerHTML = balanceElements.join('');
    }
}

function updateViewStats() {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Helpers
    const fmt = (amt, curr) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: curr,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amt);

    // Income Stats: Today USD, Month USD, Today UZS, Month UZS
    let incTodayUSD = 0,
        incMonthUSD = 0;
    let incTodayUZS = 0,
        incMonthUZS = 0;

    transactions.filter(t => t.type === 'income').forEach(t => {
        const val = parseFloat(t.amount);
        const curr = t.currency || 'USD';

        if (curr === 'USD') {
            if (t.date === today) incTodayUSD += val;
            if (t.date.startsWith(currentMonth)) incMonthUSD += val;
        } else {
            if (t.date === today) incTodayUZS += val;
            if (t.date.startsWith(currentMonth)) incMonthUZS += val;
        }
    });

    document.getElementById('income-stat-today-usd').textContent = fmt(incTodayUSD, 'USD');
    document.getElementById('income-stat-month-usd').textContent = fmt(incMonthUSD, 'USD');
    document.getElementById('income-stat-today-uzs').textContent = fmt(incTodayUZS, 'UZS');
    document.getElementById('income-stat-month-uzs').textContent = fmt(incMonthUZS, 'UZS');

    // Outcome Stats: Today USD, Month USD, Today UZS, Month UZS
    let outTodayUSD = 0,
        outMonthUSD = 0;
    let outTodayUZS = 0,
        outMonthUZS = 0;

    transactions.filter(t => t.type === 'outcome').forEach(t => {
        const val = parseFloat(t.amount);
        const curr = t.currency || 'USD';

        if (curr === 'USD') {
            if (t.date === today) outTodayUSD += val;
            if (t.date.startsWith(currentMonth)) outMonthUSD += val;
        } else {
            if (t.date === today) outTodayUZS += val;
            if (t.date.startsWith(currentMonth)) outMonthUZS += val;
        }
    });

    document.getElementById('outcome-stat-today-usd').textContent = fmt(outTodayUSD, 'USD');
    document.getElementById('outcome-stat-month-usd').textContent = fmt(outMonthUSD, 'USD');
    document.getElementById('outcome-stat-today-uzs').textContent = fmt(outTodayUZS, 'UZS');
    document.getElementById('outcome-stat-month-uzs').textContent = fmt(outMonthUZS, 'UZS');
}

window.renderLists = function () {
    // Update Filter State from DOM inputs
    incomeFilters.start = document.getElementById('income-filter-start').value;
    incomeFilters.end = document.getElementById('income-filter-end').value;
    incomeFilters.method = document.getElementById('income-filter-method').value;

    outcomeFilters.start = document.getElementById('outcome-filter-start').value;
    outcomeFilters.end = document.getElementById('outcome-filter-end').value;
    outcomeFilters.method = document.getElementById('outcome-filter-method').value;

    const incomeList = document.getElementById('income-list');
    const outcomeList = document.getElementById('outcome-list');
    const incomeSearch = document.getElementById('income-search').value.toLowerCase();
    const outcomeSearch = document.getElementById('outcome-search').value.toLowerCase();

    incomeList.innerHTML = '';
    outcomeList.innerHTML = '';

    // Tracking filtered totals for ghost text
    let incomeFilteredUSD = 0;
    let incomeFilteredUZS = 0;
    let outcomeFilteredUSD = 0;
    let outcomeFilteredUZS = 0;

    transactions.forEach(t => {
        const tCurr = t.currency || 'USD';
        const desc = t.description.toLowerCase();

        // Date Check Helper
        const checkDate = (dateStr, start, end) => {
            if (!dateStr) return true; // If no date in transaction, include it
            if (!start && !end) return true; // No filter applied, include all

            const d = new Date(dateStr);
            const s = start ? new Date(start) : null;
            const e = end ? new Date(end) : null;

            // Reset times to midnight for precise comparison
            d.setHours(0, 0, 0, 0);
            if (s) s.setHours(0, 0, 0, 0);
            if (e) e.setHours(0, 0, 0, 0);

            if (s && d < s) return false;
            // For checking 'end', we validly want to include the end date itself.
            // String comparison '2023-12-14' > '2023-12-14' is false, so it includes it.
            // With Date objects, d > e is standard.
            if (e && d > e) return false;

            return true;
        };

        // Method Check Helper
        const checkMethod = (method, filterMethod) => {
            if (filterMethod === 'All') return true;
            return (method || 'Other') === filterMethod; // Default to Other? Or maybe match exact strings
        };
        // Normalize Payment Method for filtering (match dropdown values)
        // Dropdown: Cash, Bank, Card, Other
        // Data: Cash, Bank, Card, Other (as set in modal)

        // Income Logic
        if (t.type === 'income' && tCurr === incomeCurrency) {
            const matchesSearch = desc.includes(incomeSearch);
            const matchesDate = checkDate(t.date, incomeFilters.start, incomeFilters.end);
            const matchesMethod = checkMethod(t.paymentMethod, incomeFilters.method);

            if (matchesSearch && matchesDate && matchesMethod) {
                incomeList.innerHTML += createTransactionItem(t);
                // Track filtered totals
                if (tCurr === 'USD') incomeFilteredUSD += parseFloat(t.amount);
                else incomeFilteredUZS += parseFloat(t.amount);
            }
        }

        // Outcome Logic
        if (t.type === 'outcome' && tCurr === outcomeCurrency) {
            const matchesSearch = desc.includes(outcomeSearch);
            const matchesDate = checkDate(t.date, outcomeFilters.start, outcomeFilters.end);
            const matchesMethod = checkMethod(t.paymentMethod, outcomeFilters.method);

            if (matchesSearch && matchesDate && matchesMethod) {
                outcomeList.innerHTML += createTransactionItem(t);
                // Track filtered totals
                if (tCurr === 'USD') outcomeFilteredUSD += parseFloat(t.amount);
                else outcomeFilteredUZS += parseFloat(t.amount);
            }
        }
    });

    // Update ghost text with filtered totals
    updateFilteredStats(incomeFilteredUSD, incomeFilteredUZS, outcomeFilteredUSD, outcomeFilteredUZS);

    // Update currency count badges
    updateCurrencyBadges();
};

function updateCurrencyBadges() {
    // Count income entries by currency
    let incomeUSDCount = 0;
    let incomeUZSCount = 0;

    transactions.filter(t => t.type === 'income').forEach(t => {
        const curr = t.currency || 'USD';
        if (curr === 'USD') incomeUSDCount++;
        else incomeUZSCount++;
    });

    // Count outcome entries by currency
    let outcomeUSDCount = 0;
    let outcomeUZSCount = 0;

    transactions.filter(t => t.type === 'outcome').forEach(t => {
        const curr = t.currency || 'USD';
        if (curr === 'USD') outcomeUSDCount++;
        else outcomeUZSCount++;
    });

    // Update badges
    const incUSDBadge = document.getElementById('income-usd-count');
    const incUZSBadge = document.getElementById('income-uzs-count');
    const outUSDBadge = document.getElementById('outcome-usd-count');
    const outUZSBadge = document.getElementById('outcome-uzs-count');

    if (incUSDBadge) incUSDBadge.textContent = incomeUSDCount;
    if (incUZSBadge) incUZSBadge.textContent = incomeUZSCount;
    if (outUSDBadge) outUSDBadge.textContent = outcomeUSDCount;
    if (outUZSBadge) outUZSBadge.textContent = outcomeUZSCount;
}

function updateFilteredStats(incUSD, incUZS, outUSD, outUZS) {
    const incInfo = document.getElementById('income-selection-info');
    const outInfo = document.getElementById('outcome-selection-info');
    const incText = document.getElementById('income-selection-text');
    const outText = document.getElementById('outcome-selection-text');

    // Check if any filters are active
    const hasIncomeFilters = incomeFilters.start || incomeFilters.end || incomeFilters.method !== 'All';
    const hasOutcomeFilters = outcomeFilters.start || outcomeFilters.end || outcomeFilters.method !== 'All';

    // Show filtered stats if filters are active and no selections are made
    if (hasIncomeFilters && selectedIds.size === 0) {
        let incText_str = '';
        if (incUSD > 0 || incUZS > 0) {
            const parts = [];
            if (incUSD > 0) parts.push(new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(incUSD));
            if (incUZS > 0) parts.push(new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'UZS',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(incUZS));
            incText_str = `Filtered Total: ${parts.join(' + ')}`;
        } else {
            incText_str = 'No transactions match the filters';
        }
        incText.textContent = incText_str;
        incInfo.classList.remove('d-none');
    } else if (!hasIncomeFilters && selectedIds.size === 0) {
        incInfo.classList.add('d-none');
    }
    if (hasOutcomeFilters && selectedIds.size === 0) {
        let outText_str = '';
        if (outUSD > 0 || outUZS > 0) {
            const parts = [];
            if (outUSD > 0) parts.push(new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(outUSD));
            if (outUZS > 0) parts.push(new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'UZS',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(outUZS));
            outText_str = `Filtered Total: ${parts.join(' + ')}`;
        } else {
            outText_str = 'No transactions match the filters';
        }
        outText.textContent = outText_str;
        outInfo.classList.remove('d-none');
        // Show Clear button
        document.getElementById('outcome-clear-filters').classList.remove('d-none');
    } else if (!hasOutcomeFilters && selectedIds.size === 0) {
        outInfo.classList.add('d-none');
        // Hide Clear button
        document.getElementById('outcome-clear-filters').classList.add('d-none');
    }

    // Show/hide Income Clear button
    if (hasIncomeFilters) {
        document.getElementById('income-clear-filters').classList.remove('d-none');
    } else {
        document.getElementById('income-clear-filters').classList.add('d-none');
    }
}

window.clearAllFilters = function (type) {
    if (type === 'income') {
        document.getElementById('income-search').value = '';
        document.getElementById('income-filter-start').value = '';
        document.getElementById('income-filter-end').value = '';
        document.getElementById('income-filter-method').value = 'All';
    } else if (type === 'outcome') {
        document.getElementById('outcome-search').value = '';
        document.getElementById('outcome-filter-start').value = '';
        document.getElementById('outcome-filter-end').value = '';
        document.getElementById('outcome-filter-method').value = 'All';
    }
    window.renderLists();
};

function createTransactionItem(t) {
    const isIncome = t.type === 'income';
    const amountColor = isIncome ? 'text-success' : 'text-danger';
    const iconColor = isIncome ? 'text-success bg-success-soft' : 'text-danger bg-danger-soft';
    const arrowIcon = isIncome ? 'bi-arrow-down-left' : 'bi-arrow-up-right';

    const dateObj = new Date(t.date);
    const day = dateObj.getDate();
    const month = dateObj.toLocaleDateString('en-US', {
        month: 'short'
    });

    const isSelected = selectedIds.has(t.id);

    return `
        <div class="transaction-item d-flex align-items-center justify-content-between p-2 p-md-3 shadow-sm">
            <div class="d-flex align-items-center flex-grow-1 overflow-hidden">
                <!-- Checkbox (Stop propagation to prevent opening modal) -->
                <div class="me-2 me-md-3" onclick="event.stopPropagation()">
                    <input class="form-check-input" type="checkbox" style="width: 16px; height: 16px; cursor: pointer;" 
                        ${isSelected ? 'checked' : ''} onchange="toggleSelection('${t.id}')">
                </div>

                <!-- Clickable Area for Details -->
                <div class="d-flex align-items-center flex-grow-1 cursor-pointer" onclick="openDetailsModal('${t.id}')">
                    <!-- Date -->
                    <div class="d-flex flex-column align-items-center justify-content-center me-2 me-md-3 border border-light rounded-3 bg-white" style="width: 40px; height: 40px; min-width: 40px;">
                        <span class="fw-bold text-dark lh-1" style="font-size: 0.9rem;">${day}</span>
                        <span class="text-uppercase-xs text-muted lh-1 mt-1" style="font-size: 0.65rem;">${month}</span>
                    </div>
                    
                    <!-- Icon (Hidden on mobile) -->
                    <div class="me-3 d-none d-sm-flex">
                         <div class="rounded-circle d-flex align-items-center justify-content-center ${iconColor}" style="width: 40px; height: 40px;">
                            <i class="bi ${arrowIcon} fs-5"></i>
                         </div>
                    </div>

                    <!-- Details -->
                    <div class="d-flex flex-column justify-content-center overflow-hidden me-2">
                        <div class="mb-0 fw-bold text-dark text-truncate" style="font-size: 0.9rem;">${t.description}</div>
                        <div class="d-flex align-items-center gap-2 mt-1">
                            <span class="badge bg-white border border-light text-muted fw-normal rounded-pill px-2 py-0" style="font-size: 0.65rem;">
                                ${t.paymentMethod || 'General'}
                            </span>
                        </div>
                    </div>
                    
                    <!-- Amount is also part of the clickable area for better UX -->
                    <div class="text-end ms-auto me-3">
                        <span class="${amountColor} fw-black d-block text-nowrap" style="font-size: 1rem;">
                            ${isIncome ? '+' : '-'}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(t.amount)}
                        </span>
                        <small class="text-uppercase-xs text-muted" style="font-size: 0.65rem;">${t.currency || 'USD'}</small>
                    </div>
                </div>
            </div>
            
            <!-- Actions (Stop propagation) -->
            <div class="d-flex align-items-center gap-1 action-buttons" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-light border-0 text-muted hover-primary p-1 rounded-circle" onclick="editTransaction('${t.id}')" title="Edit" style="width: 28px; height: 28px;">
                    <i class="bi bi-pencil-fill" style="font-size: 0.8rem;"></i>
                </button>
                <button class="btn btn-sm btn-light border-0 text-muted hover-danger p-1 rounded-circle" onclick="deleteTransaction('${t.id}')" title="Delete" style="width: 28px; height: 28px;">
                    <i class="bi bi-trash-fill" style="font-size: 0.8rem;"></i>
                </button>
            </div>
        </div>
    `;
}

// Selection & Action Logic
window.toggleSelection = (id) => {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    updateSelectionBar();
};

window.clearSelection = () => {
    selectedIds.clear();
    updateSelectionBar();
    renderLists(); // Re-render to uncheck boxes
};

function updateSelectionBar() {
    const incInfo = document.getElementById('income-selection-info');
    const outInfo = document.getElementById('outcome-selection-info');
    const incText = document.getElementById('income-selection-text');
    const outText = document.getElementById('outcome-selection-text');

    if (selectedIds.size > 0) {
        let total = 0;
        let currency = null;
        let diffCurrencies = false;

        selectedIds.forEach(id => {
            const t = transactions.find(tr => tr.id === id);
            if (t) {
                const tCurr = t.currency || 'USD';
                if (!currency) currency = tCurr;
                else if (currency !== tCurr) diffCurrencies = true;

                total += parseFloat(t.amount);
            }
        });

        const text = diffCurrencies ?
            `${selectedIds.size} Selected | Mixed Currencies` :
            `${selectedIds.size} Selected | Total: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(total)}`;

        // Show in active view
        const activeView = document.querySelector('.view-section:not(.d-none)');
        if (activeView && activeView.id === 'view-income') {
            incText.textContent = text;
            incInfo.classList.remove('d-none');
            // Hide filtered stats when selections exist
            outInfo.classList.add('d-none');
        } else if (activeView && activeView.id === 'view-outcome') {
            outText.textContent = text;
            outInfo.classList.remove('d-none');
            // Hide filtered stats when selections exist
            incInfo.classList.add('d-none');
        }

    } else {
        // When no selections, trigger re-render to show filtered stats
        renderLists();
    }
}

window.deleteTransaction = async (id) => {
    if (confirm('Are you sure you want to delete this transaction?')) {
        try {
            await deleteDoc(doc(db, "transactions", id));
            selectedIds.delete(id); // Remove from selection if exists
            updateSelectionBar();
        } catch (error) {
            console.error("Error removing document: ", error);
            alert("Error deleting transaction");
        }
    }
};

window.editTransaction = (id) => {
    const t = transactions.find(tr => tr.id === id);
    if (!t) return;

    editingId = id;

    // Populate Modal
    document.getElementById('transactionType').value = t.type;
    document.getElementById('transactionModalLabel').textContent = `Edit ${t.type.charAt(0).toUpperCase() + t.type.slice(1)}`;

    document.getElementById('amount').value = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(t.amount); // Will need stripping on submit
    document.getElementById('currency').value = t.currency || 'USD';
    document.getElementById('date').value = t.date;
    document.getElementById('paymentMethod').value = t.paymentMethod || 'Cash';
    document.getElementById('description').value = t.description;

    document.getElementById('saveTransactionBtn').querySelector('.btn-text').textContent = 'Update Transaction';

    transactionModal.show();
};

// Archive Functions
window.archiveAllTransactions = async () => {
    if (transactions.length === 0) {
        alert('No transactions to archive!');
        return;
    }

    const confirmed = confirm('Archive all current transactions? This will clear the active dashboard and move all data to Archive.\n\nThis action cannot be undone.');
    if (!confirmed) return;

    try {
        // Find date range
        const dates = transactions.map(t => new Date(t.date));
        const startDate = new Date(Math.min(...dates));
        const endDate = new Date(Math.max(...dates));

        // Format dates as DD.MM.YYYY
        const formatDate = (d) => {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}.${month}.${year}`;
        };

        const archiveName = `${formatDate(startDate)}–${formatDate(endDate)} Archive`;

        // Create archive record
        const archiveDoc = await addDoc(collection(db, "archives"), {
            name: archiveName,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            createdAt: new Date().toISOString(),
            transactionCount: transactions.length,
            transactions: transactions.map(t => ({
                ...t
            }))
        });

        // Delete all active transactions
        const deletePromises = transactions.map(t => deleteDoc(doc(db, "transactions", t.id)));
        await Promise.all(deletePromises);

        alert(`Archive created: ${archiveName}`);

        // Navigate to archive view
        setTimeout(() => route('archive'), 500);
    } catch (error) {
        console.error("Error archiving transactions: ", error);
        alert("Error archiving transactions: " + error.message);
    }
};

function listenForArchives() {
    // Basic query to get archives - ensure 'archives' collection exists and has 'createdAt'
    const q = query(collection(db, "archives"), orderBy("createdAt", "desc"));

    // Set up real-time listener with error handling
    cleanupArchiveListener = onSnapshot(q, (snapshot) => {
        archives = [];
        snapshot.forEach((doc) => {
            archives.push({
                id: doc.id,
                ...doc.data()
            });
        });
        displayArchives();
    }, (error) => {
        console.error("Error fetching archives:", error);
        if (error.code === 'failed-precondition') {
            alert("Database Index Required for Archives. Check console.");
        }
    });
}

window.displayArchives = function () {
    const archiveList = document.getElementById('archive-list');
    if (!archiveList) return;

    // Force strict reset of view state
    window.currentArchive = null;
    archiveSelectedIds.clear();

    // Reset visual filter inputs
    const searchEl = document.getElementById('archive-search');
    const startEl = document.getElementById('archive-filter-start');
    const endEl = document.getElementById('archive-filter-end');
    const methodEl = document.getElementById('archive-filter-method');
    const typeEl = document.getElementById('archive-filter-type');

    if (searchEl) searchEl.value = '';
    if (startEl) startEl.value = '';
    if (endEl) endEl.value = '';
    if (methodEl) methodEl.value = 'All';
    if (typeEl) typeEl.value = 'All';

    const clearBtn = document.getElementById('archive-clear-filters');
    const infoEl = document.getElementById('archive-selection-info');
    if (clearBtn) clearBtn.classList.add('d-none');
    if (infoEl) infoEl.classList.add('d-none');

    archiveList.innerHTML = '';

    if (archives.length === 0) {
        archiveList.innerHTML = `
            <div class="glass-panel p-5 text-center mt-3">
                <i class="bi bi-inbox fs-1 text-secondary mb-3 d-block opacity-50"></i>
                <h5 class="text-dark fw-bold">No Archives Fetched</h5>
                <p class="text-secondary small">If you archived data, it should appear here.</p>
            </div>
        `;
        return;
    }

    archives.forEach(archive => {
        const dateStr = archive.createdAt ? new Date(archive.createdAt).toLocaleDateString() : 'Unknown Date';
        const itemCount = archive.transactionCount || 0;

        const itemHTML = `
            <div class="glass-card mb-3 p-3 w-100 cursor-pointer d-flex align-items-center justify-content-between" onclick="viewArchiveDetails('${archive.id}')">
                <div class="d-flex align-items-center gap-3">
                    <div class="rounded-circle bg-primary-soft text-primary d-flex align-items-center justify-content-center flex-shrink-0" style="width: 48px; height: 48px;">
                        <i class="bi bi-archive-fill fs-5"></i>
                    </div>
                    <div class="overflow-hidden">
                        <h6 class="mb-1 fw-bold text-dark text-truncate">${archive.name || 'Untitled Archive'}</h6>
                        <div class="d-flex align-items-center gap-2">
                             <span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-10 rounded-pill px-2">
                                ${itemCount} items
                             </span>
                             <small class="text-muted" style="font-size: 0.75rem;">${dateStr}</small>
                        </div>
                    </div>
                </div>
                <div class="rounded-circle bg-white border d-flex align-items-center justify-content-center shadow-sm flex-shrink-0" style="width: 36px; height: 36px;">
                    <i class="bi bi-chevron-right text-muted"></i>
                </div>
            </div>
        `;
        archiveList.innerHTML += itemHTML;
    });

    updateArchiveStats();
};

function updateArchiveStats() {
    let totalUSD = 0;
    let totalUZS = 0;

    archives.forEach(archive => {
        if (archive.transactions && Array.isArray(archive.transactions)) {
            archive.transactions.forEach(t => {
                const curr = t.currency || 'USD';
                if (curr === 'USD') totalUSD += parseFloat(t.amount);
                else totalUZS += parseFloat(t.amount);
            });
        }
    });

    const fmt = (amt, curr) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: curr,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amt);

    const statUSD = document.getElementById('archive-stat-usd');
    const statUZS = document.getElementById('archive-stat-uzs');
    if (statUSD) statUSD.textContent = fmt(totalUSD, 'USD');
    if (statUZS) statUZS.textContent = fmt(totalUZS, 'UZS');
}

window.viewArchiveDetails = (archiveId) => {
    // Store current view
    window.currentArchive = archives.find(a => a.id === archiveId);
    if (!window.currentArchive) return;

    // Reset filters when opening archive
    archiveFilters.start = '';
    archiveFilters.end = '';
    archiveFilters.method = 'All';
    archiveFilters.type = 'All';
    archiveSelectedIds.clear();

    // Reset filter inputs
    document.getElementById('archive-search').value = '';
    document.getElementById('archive-filter-start').value = '';
    document.getElementById('archive-filter-end').value = '';
    document.getElementById('archive-filter-method').value = 'All';
    document.getElementById('archive-filter-type').value = 'All';
    document.getElementById('archive-clear-filters').classList.add('d-none');
    document.getElementById('archive-selection-info').classList.add('d-none');

    // Display the filtered entries
    filterArchiveEntries();
};

window.filterArchiveEntries = function () {
    const archive = window.currentArchive;
    if (!archive || !archive.transactions) {
        console.error("No archive data found for filtering");
        return;
    }

    // Get filter values
    archiveFilters.start = document.getElementById('archive-filter-start').value;
    archiveFilters.end = document.getElementById('archive-filter-end').value;
    archiveFilters.method = document.getElementById('archive-filter-method').value;
    archiveFilters.type = document.getElementById('archive-filter-type').value;
    const searchTerm = (document.getElementById('archive-search').value || '').toLowerCase();

    const archiveList = document.getElementById('archive-list');
    if (!archiveList) return;

    // Use an array to build HTML to prevent DOM thrashing
    const htmlParts = [];

    // Header
    htmlParts.push(`
        <div class="mb-3">
            <button class="btn btn-outline-secondary btn-sm" onclick="displayArchives()">
                <i class="bi bi-chevron-left me-1"></i> Back
            </button>
        </div>
        <div class="glass-card p-4 mb-4">
            <h4 class="fw-bold mb-3">${archive.name}</h4>
            <p class="text-secondary mb-0">Created: ${new Date(archive.createdAt).toLocaleDateString()}</p>
        </div>
    `);

    // Helper functions
    const checkDate = (dateStr, start, end) => {
        if (!dateStr) return true;
        if (!start && !end) return true;

        const d = new Date(dateStr);
        const s = start ? new Date(start) : null;
        const e = end ? new Date(end) : null;

        d.setHours(0, 0, 0, 0);
        if (s) s.setHours(0, 0, 0, 0);
        if (e) e.setHours(0, 0, 0, 0);

        if (s && d < s) return false;
        if (e && d > e) return false;

        return true;
    };

    const checkMethod = (method, filterMethod) => {
        if (filterMethod === 'All') return true;
        return (method || 'Other') === filterMethod;
    };

    const checkType = (type, filterType) => {
        if (filterType === 'All') return true;
        return type === filterType;
    };

    // Filter and display entries
    let incomeTotal = 0,
        outcomeTotal = 0;
    let incomeUSD = 0,
        incomeUZS = 0,
        outcomeUSD = 0,
        outcomeUZS = 0;
    let filteredCount = 0;

    const filtered = archive.transactions.filter(t => {
        const desc = (t.description || '').toLowerCase();
        const matchesSearch = desc.includes(searchTerm);
        const matchesDate = checkDate(t.date, archiveFilters.start, archiveFilters.end);
        const matchesMethod = checkMethod(t.paymentMethod, archiveFilters.method);
        const matchesType = checkType(t.type, archiveFilters.type);

        if (matchesSearch && matchesDate && matchesMethod && matchesType) {
            filteredCount++;
            const curr = t.currency || 'USD';
            if (t.type === 'income') {
                incomeTotal += parseFloat(t.amount);
                if (curr === 'USD') incomeUSD += parseFloat(t.amount);
                else incomeUZS += parseFloat(t.amount);
            } else {
                outcomeTotal += parseFloat(t.amount);
                if (curr === 'USD') outcomeUSD += parseFloat(t.amount);
                else outcomeUZS += parseFloat(t.amount);
            }
            return true;
        }
        return false;
    });

    // Group by type
    const incomeEntries = filtered.filter(t => t.type === 'income');
    const outcomeEntries = filtered.filter(t => t.type === 'outcome');

    if (incomeEntries.length > 0) {
        htmlParts.push('<h6 class="fw-bold text-success mt-4 mb-3">Income Entries</h6>');
        incomeEntries.forEach(t => {
            const isSelected = archiveSelectedIds.has(t.id);
            htmlParts.push(createArchiveTransactionItem(t, isSelected));
        });
    }

    if (outcomeEntries.length > 0) {
        htmlParts.push('<h6 class="fw-bold text-danger mt-4 mb-3">Outcome Entries</h6>');
        outcomeEntries.forEach(t => {
            const isSelected = archiveSelectedIds.has(t.id);
            htmlParts.push(createArchiveTransactionItem(t, isSelected));
        });
    }

    if (filteredCount === 0) {
        htmlParts.push('<div class="text-center text-secondary py-5"><p>No transactions match the filters</p></div>');
    }

    // Render all at once
    archiveList.innerHTML = htmlParts.join('');

    // Show/hide clear filters button
    const hasFilters = archiveFilters.start || archiveFilters.end || archiveFilters.method !== 'All' || archiveFilters.type !== 'All' || searchTerm;
    const clearBtn = document.getElementById('archive-clear-filters');
    if (hasFilters) {
        clearBtn.classList.remove('d-none');
    } else {
        clearBtn.classList.add('d-none');
    }

    // Update selection info
    updateArchiveSelectionInfo();
};



window.clearArchiveFilters = function () {
    document.getElementById('archive-search').value = '';
    document.getElementById('archive-filter-start').value = '';
    document.getElementById('archive-filter-end').value = '';
    document.getElementById('archive-filter-method').value = 'All';
    document.getElementById('archive-filter-type').value = 'All';
    archiveSelectedIds.clear();
    filterArchiveEntries();
};

window.toggleArchiveSelection = (id) => {
    if (archiveSelectedIds.has(id)) {
        archiveSelectedIds.delete(id);
    } else {
        archiveSelectedIds.add(id);
    }
    updateArchiveSelectionInfo();
    // Re-render to update checkbox states
    filterArchiveEntries();
};

function updateArchiveSelectionInfo() {
    const selInfo = document.getElementById('archive-selection-info');
    const selText = document.getElementById('archive-selection-text');

    if (archiveSelectedIds.size > 0 && window.currentArchive) {
        let total = 0;
        let currency = null;
        let diffCurrencies = false;

        archiveSelectedIds.forEach(id => {
            const t = window.currentArchive.transactions.find(tr => tr.id === id);
            if (t) {
                const tCurr = t.currency || 'USD';
                if (!currency) currency = tCurr;
                else if (currency !== tCurr) diffCurrencies = true;
                total += parseFloat(t.amount);
            }
        });

        const text = diffCurrencies ?
            `${archiveSelectedIds.size} Selected | Mixed Currencies` :
            `${archiveSelectedIds.size} Selected | Total: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(total)}`;

        selText.textContent = text;
        selInfo.classList.remove('d-none');
    } else {
        selInfo.classList.add('d-none');
    }
}

function createArchiveTransactionItem(t, isSelected = false) {
    const isIncome = t.type === 'income';
    const amountColor = isIncome ? 'text-success' : 'text-danger';
    const iconColor = isIncome ? 'text-success bg-success-soft' : 'text-danger bg-danger-soft';
    const arrowIcon = isIncome ? 'bi-arrow-down-left' : 'bi-arrow-up-right';

    const dateObj = new Date(t.date);
    const day = dateObj.getDate();
    const month = dateObj.toLocaleDateString('en-US', {
        month: 'short'
    });

    return `
        <div class="transaction-item d-flex align-items-center justify-content-between p-3 mb-2 shadow-sm">
            <div class="d-flex align-items-center flex-grow-1 overflow-hidden">
                <!-- Checkbox -->
                <div class="me-3">
                    <input class="form-check-input" type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" 
                        ${isSelected ? 'checked' : ''} onchange="toggleArchiveSelection('${t.id}')">
                </div>

                <!-- Date -->
                <div class="d-flex flex-column align-items-center justify-content-center me-3 border border-light rounded-3 bg-white" style="width: 48px; height: 48px; min-width: 48px;">
                    <span class="fw-bold fs-6 text-dark lh-1">${day}</span>
                    <span class="text-uppercase-xs text-muted lh-1 mt-1">${month}</span>
                </div>
                
                <!-- Icon -->
                <div class="me-3 d-none d-sm-flex">
                     <div class="rounded-circle d-flex align-items-center justify-content-center ${iconColor}" style="width: 40px; height: 40px;">
                        <i class="bi ${arrowIcon} fs-5"></i>
                     </div>
                </div>

                <!-- Details -->
                <div class="d-flex flex-column justify-content-center overflow-hidden me-3">
                    <h6 class="mb-0 fw-bold text-dark text-truncate">${t.description}</h6>
                    <div class="d-flex align-items-center gap-2 mt-1">
                        <small class="text-uppercase-xs text-muted">${t.paymentMethod || 'General'}</small>
                    </div>
                </div>
            </div>
            
            <!-- Amount -->
            <div class="text-end ms-auto">
                <span class="${amountColor} fw-black fs-5 d-block text-nowrap">
                    ${isIncome ? '+' : '-'}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(t.amount)}
                </span>
                <small class="text-uppercase-xs text-muted">${t.currency || 'USD'}</small>
            </div>
        </div>
    `;
}