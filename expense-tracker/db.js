// ============================================================
// IWD Expense Tracker — Database Abstraction Layer
// Connects to Supabase with localStorage as fallback/cache
// ============================================================
var DB = (function () {
    'use strict';

    var SUPABASE_URL = 'https://ynrpkvhroaeiomxuksyw.supabase.co';
    var SUPABASE_KEY = 'sb_publishable_mtUWtxgIIhWN0kQc2xZbMQ_EStR6jkG';

    var STORAGE_KEY = 'iwd_expenses';
    var BUDGET_KEY = 'iwd_monthly_budget';
    var supabase = null;
    var mode = 'local'; // 'local' or 'supabase'

    // ---- Init ----
    function init() {
        try {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            mode = 'supabase';
        } catch (e) {
            console.warn('Supabase init failed, falling back to local:', e);
            mode = 'local';
        }
        return mode;
    }

    function getMode() { return mode; }

    // ---- Local storage helpers ----
    function loadLocal() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch (e) { return []; }
    }

    function saveLocal(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    // ---- CRUD Operations ----
    async function loadAll() {
        if (mode === 'supabase') {
            var result = await supabase.from('expenses').select('*').order('date', { ascending: false });
            if (result.error) {
                console.error('Supabase load error:', result.error);
                return loadLocal();
            }
            // Also cache locally
            saveLocal(result.data);
            return result.data;
        }
        return loadLocal();
    }

    async function saveExpense(expense) {
        if (mode === 'supabase') {
            var result = await supabase.from('expenses').upsert(expense, { onConflict: 'id' });
            if (result.error) {
                console.error('Supabase save error:', result.error);
                // Fallback: save locally
                var local = loadLocal();
                var idx = local.findIndex(function (e) { return e.id === expense.id; });
                if (idx >= 0) local[idx] = expense; else local.push(expense);
                saveLocal(local);
                return false;
            }
            // Update local cache
            var local = loadLocal();
            var idx = local.findIndex(function (e) { return e.id === expense.id; });
            if (idx >= 0) local[idx] = expense; else local.push(expense);
            saveLocal(local);
            return true;
        }
        var local = loadLocal();
        var idx = local.findIndex(function (e) { return e.id === expense.id; });
        if (idx >= 0) local[idx] = expense; else local.push(expense);
        saveLocal(local);
        return true;
    }

    async function saveBulk(expensesArray) {
        if (mode === 'supabase') {
            var result = await supabase.from('expenses').upsert(expensesArray, { onConflict: 'id' });
            if (result.error) {
                console.error('Supabase bulk save error:', result.error);
            }
        }
        // Always update local cache
        var local = loadLocal();
        expensesArray.forEach(function (expense) {
            var idx = local.findIndex(function (e) { return e.id === expense.id; });
            if (idx >= 0) local[idx] = expense; else local.push(expense);
        });
        saveLocal(local);
    }

    async function deleteExpense(id) {
        if (mode === 'supabase') {
            var result = await supabase.from('expenses').delete().eq('id', id);
            if (result.error) console.error('Supabase delete error:', result.error);
        }
        var local = loadLocal();
        saveLocal(local.filter(function (e) { return e.id !== id; }));
    }

    // ---- Budget ----
    async function getBudget() {
        if (mode === 'supabase') {
            var result = await supabase.from('settings').select('value').eq('key', 'monthly_budget').single();
            if (result.data) return parseFloat(result.data.value) || 0;
        }
        return parseFloat(localStorage.getItem(BUDGET_KEY)) || 0;
    }

    async function setBudget(val) {
        if (mode === 'supabase') {
            await supabase.from('settings').upsert({ key: 'monthly_budget', value: String(val) }, { onConflict: 'key' });
        }
        localStorage.setItem(BUDGET_KEY, String(val));
    }

    return {
        init: init,
        getMode: getMode,
        loadAll: loadAll,
        saveExpense: saveExpense,
        saveBulk: saveBulk,
        deleteExpense: deleteExpense,
        getBudget: getBudget,
        setBudget: setBudget,
    };
})();
