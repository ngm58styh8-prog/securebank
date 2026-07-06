(function() {
    const adminEmail = requireAdminAuth();
    if (!adminEmail) return;

let pendingAdjust = { email: "", action: "" };
let pendingSupport = { email: "", ticketId: "" };
let userSearchQuery = "";

const HOLDING_LABELS = {
    btc: "Bitcoin", eth: "Ethereum", sol: "Solana", xrp: "XRP", gold: "Gold",
    aapl: "Apple", googl: "Alphabet", msft: "Microsoft", nvda: "NVIDIA",
    spy: "S&P 500 ETF", qqq: "Nasdaq ETF", vti: "Total Market ETF"
};

function formatPaymentType(type) {
    if (type === "deposit") return "Deposit";
    if (type === "withdraw") return "Withdrawal";
    if (type === "admin-credit") return "Admin Credit";
    if (type === "admin-debit") return "Admin Debit";
    return type;
}

function isPositivePayment(type) {
    return type === "deposit" || type === "admin-credit";
}

function formatTxAmount(amount) {
    const sign = amount < 0 ? "−" : "+";
    return sign + formatMoney(Math.abs(amount));
}

function formatUserStatus(user) {
    const parts = [];
    if (!user.accountComplete) parts.push("Incomplete profile");
    if (user.emailVerified) parts.push("Email verified");
    else parts.push("Email pending");
    parts.push(user.verificationStatus || "Pending");
    return parts.join(" · ");
}

function formatLastLogin(user) {
    if (!user.lastLoginAt) return "Never";
    const when = new Date(user.lastLoginAt).toLocaleString();
    return user.lastLoginDevice ? when + "<br><span class=\"admin-email\">" + user.lastLoginDevice + "</span>" : when;
}

function formatPendingSummary(user) {
    const parts = [];
    if (user.pendingDeposits) parts.push(user.pendingDeposits + " deposit" + (user.pendingDeposits === 1 ? "" : "s"));
    if (user.pendingTransfers) parts.push(user.pendingTransfers + " transfer" + (user.pendingTransfers === 1 ? "" : "s"));
    return parts.length ? parts.join(" · ") : "—";
}

function getFilteredUsers() {
    const users = getAllUsersSummary();
    if (!userSearchQuery) return users;
    const q = userSearchQuery.toLowerCase();
    return users.filter(function(u) {
        return u.name.toLowerCase().indexOf(q) !== -1 ||
            u.email.toLowerCase().indexOf(q) !== -1 ||
            (u.phone && String(u.phone).toLowerCase().indexOf(q) !== -1);
    });
}

function populateUserSelects() {
    const users = getAllUsersSummary();
    const adjustSelect = document.getElementById("adjustUser");
    const activityFilter = document.getElementById("activityFilter");
    const notifTarget = document.getElementById("notifTarget");
    const adjustCurrent = adjustSelect.value;
    const filterCurrent = activityFilter.value;
    const notifCurrent = notifTarget ? notifTarget.value : "";

    const options = users.map(function(u) {
        return `<option value="${u.email}">${u.name} (${u.email})</option>`;
    }).join("");

    adjustSelect.innerHTML = '<option value="">Select a user…</option>' +
        users.map(function(u) {
            return `<option value="${u.email}">${u.name} (${u.email}) — ${formatMoney(u.cash)}</option>`;
        }).join("");

    activityFilter.innerHTML = '<option value="">All users</option>' + options;

    if (notifTarget) {
        notifTarget.innerHTML = '<option value="all">All users</option>' + options;
        if (notifCurrent === "all" || users.some(function(u) { return u.email === notifCurrent; })) {
            notifTarget.value = notifCurrent || "all";
        }
    }

    if (adjustCurrent && users.some(function(u) { return u.email === adjustCurrent; })) {
        adjustSelect.value = adjustCurrent;
    }
    if (filterCurrent && users.some(function(u) { return u.email === filterCurrent; })) {
        activityFilter.value = filterCurrent;
    }
}

function renderActivityFeed() {
    const filter = document.getElementById("activityFilter").value;
    const activities = getAllUserActivity(filter, 50);
    const tbody = document.getElementById("activityBody");

    if (!activities.length) {
        tbody.innerHTML = '<tr><td colspan="4">No user activity yet.</td></tr>';
        return;
    }

    tbody.innerHTML = activities.map(function(a) {
        const amtClass = a.amount >= 0 ? "pl-positive" : "pl-negative";
        return `<tr>
            <td>${a.date}</td>
            <td>${a.userName}<br><span class="admin-email">${a.userEmail}</span></td>
            <td>${a.description}</td>
            <td class="${amtClass}">${formatTxAmount(a.amount)}</td>
        </tr>`;
    }).join("");
}

function formatHoldingValue(key, val) {
    if (!val || val <= 0) return null;
    if (key === "btc") return val.toFixed(4) + " BTC";
    if (key === "xrp") return Math.round(val).toLocaleString() + " XRP";
    if (key === "gold") return val.toFixed(2) + " oz";
    if (key === "aapl" || key === "googl" || key === "msft" || key === "nvda" ||
        key === "spy" || key === "qqq" || key === "vti") {
        return Math.round(val) + " shares";
    }
    return val.toFixed(2) + " " + key.toUpperCase();
}

function openMonitorModal(email) {
    const detail = getUserDetailForAdmin(email);
    if (!detail) return;

    document.getElementById("monitorTitle").textContent = detail.profile.fullName + " — Account Monitor";

    document.getElementById("monitorProfile").innerHTML =
        `<p><strong>Email:</strong> ${detail.email}</p>
         <p><strong>Phone:</strong> ${detail.profile.phone || "—"}</p>
         <p><strong>Email verified:</strong> ${detail.emailVerified ? "Yes" : "No"}</p>
         <p><strong>Member since:</strong> ${detail.profile.memberSince
            ? new Date(detail.profile.memberSince).toLocaleDateString() : "—"}</p>
         <p><strong>Last login:</strong> ${detail.profile.lastLoginAt
            ? new Date(detail.profile.lastLoginAt).toLocaleString() : "Never"}</p>
         <p><strong>Last device:</strong> ${detail.profile.lastLoginDevice || "—"}</p>
         <p><strong>Status:</strong> ${detail.profile.verificationStatus || "—"}</p>
         <p><strong>SSN on file:</strong> ${detail.profile.ssnLast4
            ? "***-**-" + detail.profile.ssnLast4 : "Not submitted"}</p>`;

    document.getElementById("monitorBalances").innerHTML =
        `<div class="admin-balance-row">
            <span>Cash Balance</span>
            <strong class="pl-positive">${formatMoney(detail.cash)}</strong>
         </div>
         <div class="admin-balance-row">
            <span>Total Transactions</span>
            <strong>${detail.transactionCount}</strong>
         </div>`;

    const holdingsEl = document.getElementById("monitorHoldings");
    const holdingKeys = Object.keys(HOLDING_LABELS);
    const activeHoldings = holdingKeys.filter(function(k) {
        return (detail.holdings[k] || 0) > 0;
    });

    if (!activeHoldings.length) {
        holdingsEl.innerHTML = '<p class="admin-empty">No asset holdings</p>';
    } else {
        holdingsEl.innerHTML = activeHoldings.map(function(key) {
            return `<div class="admin-holding-chip">
                <span class="admin-holding-name">${HOLDING_LABELS[key]}</span>
                <span class="admin-holding-val">${formatHoldingValue(key, detail.holdings[key])}</span>
            </div>`;
        }).join("");
    }

    const txBody = document.getElementById("monitorTransactions");
    if (!detail.transactions.length) {
        txBody.innerHTML = '<tr><td colspan="3">No transactions</td></tr>';
    } else {
        txBody.innerHTML = detail.transactions.slice(0, 20).map(function(t) {
            const cls = t.amount >= 0 ? "pl-positive" : "pl-negative";
            return `<tr>
                <td>${t.date}</td>
                <td>${t.description}</td>
                <td class="${cls}">${formatTxAmount(t.amount)}</td>
            </tr>`;
        }).join("");
    }

    const notifEl = document.getElementById("monitorNotifications");
    if (!detail.notifications.length) {
        notifEl.innerHTML = '<p class="admin-empty">No notifications</p>';
    } else {
        notifEl.innerHTML = detail.notifications.slice(0, 10).map(function(n) {
            return `<div class="admin-notif-item ${n.read ? "" : "unread"}">
                <span class="notif-check">✓</span> ${n.message}
                <div class="notif-time">${new Date(n.time).toLocaleString()}</div>
            </div>`;
        }).join("");
    }

    const pendingEl = document.getElementById("monitorPending");
    const pendingParts = [];
    if (detail.pendingDeposits && detail.pendingDeposits.length) {
        pendingParts.push("<strong>Deposits:</strong><ul>" + detail.pendingDeposits.map(function(d) {
            return "<li>" + formatMoney(d.amount) + " · " + d.method + " · " + d.date + "</li>";
        }).join("") + "</ul>");
    }
    if (detail.pendingTransfers && detail.pendingTransfers.length) {
        pendingParts.push("<strong>Transfers:</strong><ul>" + detail.pendingTransfers.map(function(t) {
            return "<li>" + formatMoney(t.amount) + " → " + t.destination + " · " + t.date + "</li>";
        }).join("") + "</ul>");
    }
    pendingEl.innerHTML = pendingParts.length
        ? pendingParts.join("")
        : '<p class="admin-empty">No pending requests</p>';

    const supportEl = document.getElementById("monitorSupport");
    if (!detail.supportItems || !detail.supportItems.length) {
        supportEl.innerHTML = '<p class="admin-empty">No support tickets</p>';
    } else {
        supportEl.innerHTML = "<ul>" + detail.supportItems.slice(0, 8).map(function(item) {
            return "<li><strong>" + item.subject + "</strong> · " + item.status + " · " + item.date + "</li>";
        }).join("") + "</ul>";
    }

    document.getElementById("monitorModal").classList.remove("hidden");
}

function closeMonitorModal() {
    document.getElementById("monitorModal").classList.add("hidden");
}

function renderPendingTransfersAdmin() {
    const pending = getPendingTransfers();
    const countEl = document.getElementById("pendingTransferCount");
    const tbody = document.getElementById("pendingTransfersBody");

    if (countEl) countEl.textContent = String(pending.length);

    if (!tbody) return;

    if (!pending.length) {
        tbody.innerHTML = '<tr><td colspan="6">No pending transfer requests.</td></tr>';
        return;
    }

    tbody.innerHTML = pending.map(function(t) {
        return `<tr>
            <td>${t.date}</td>
            <td>${t.userName}<br><span class="admin-email">${t.userEmail}</span></td>
            <td>${t.destination}</td>
            <td>${t.method}</td>
            <td class="pl-negative">${formatMoney(t.amount)}</td>
            <td class="admin-row-actions">
                <button type="button" class="admin-approve-btn" data-id="${t.id}">Approve</button>
                <button type="button" class="admin-reject-btn" data-id="${t.id}">Reject</button>
            </td>
        </tr>`;
    }).join("");
}

function renderPendingDepositsAdmin() {
    const pending = getPendingDeposits();
    const countEl = document.getElementById("pendingDepositCount");
    const tbody = document.getElementById("pendingDepositsBody");

    if (countEl) countEl.textContent = String(pending.length);
    if (!tbody) return;

    if (!pending.length) {
        tbody.innerHTML = '<tr><td colspan="6">No pending deposit requests.</td></tr>';
        return;
    }

    tbody.innerHTML = pending.map(function(d) {
        const payToShort = d.payTo.length > 40 ? d.payTo.slice(0, 40) + "…" : d.payTo;
        return `<tr>
            <td>${d.date}</td>
            <td>${d.userName}<br><span class="admin-email">${d.userEmail}</span></td>
            <td>${d.method}</td>
            <td class="admin-payto-cell" title="${d.payTo}">${payToShort}</td>
            <td class="pl-positive">${formatMoney(d.amount)}</td>
            <td class="admin-row-actions">
                <button type="button" class="admin-approve-btn admin-approve-deposit" data-id="${d.id}">Approve</button>
                <button type="button" class="admin-reject-btn admin-reject-deposit" data-id="${d.id}">Reject</button>
            </td>
        </tr>`;
    }).join("");
}

function loadWalletSettings() {
    const admin = getAdminData();
    const walletInput = document.getElementById("adminWalletInput");
    const bankInput = document.getElementById("adminBankInput");
    if (walletInput) walletInput.value = admin.walletAddress || "";
    if (bankInput) bankInput.value = admin.bankDetails || "";
}

function loadWebsiteSettingsForm() {
    const ws = getWebsiteSettings();
    const siteNameInput = document.getElementById("siteNameInput");
    const siteTaglineInput = document.getElementById("siteTaglineInput");
    const supportEmailInput = document.getElementById("supportEmailInput");
    const announcementInput = document.getElementById("announcementInput");
    const maintenanceInput = document.getElementById("maintenanceModeInput");

    if (siteNameInput) siteNameInput.value = ws.siteName;
    if (siteTaglineInput) siteTaglineInput.value = ws.siteTagline;
    if (supportEmailInput) supportEmailInput.value = ws.supportEmail;
    if (announcementInput) announcementInput.value = ws.announcement;
    if (maintenanceInput) maintenanceInput.checked = ws.maintenanceMode;
}

function renderNotificationLog() {
    const log = getAdminNotificationLog();
    const tbody = document.getElementById("notificationLogBody");
    if (!tbody) return;

    if (!log.length) {
        tbody.innerHTML = '<tr><td colspan="4">No notifications sent yet.</td></tr>';
        return;
    }

    tbody.innerHTML = log.map(function(entry) {
        const msg = entry.message.length > 80 ? entry.message.slice(0, 80) + "…" : entry.message;
        return `<tr>
            <td>${entry.date}</td>
            <td>${entry.target}</td>
            <td title="${entry.message.replace(/"/g, "&quot;")}">${msg}</td>
            <td>${entry.recipientCount}</td>
        </tr>`;
    }).join("");
}

function formatSupportType(type) {
    if (type === "fraud") return "Fraud Report";
    if (type === "chat") return "Live Chat";
    return "Ticket";
}

function supportStatusClass(status) {
    if (status === "Urgent") return "pl-negative";
    if (status === "Resolved") return "pl-positive";
    return "";
}

function renderSupportAdmin() {
    const filter = document.getElementById("supportFilter").value;
    const items = getAllSupportItems(filter);
    const tbody = document.getElementById("supportBody");
    const countEl = document.getElementById("openSupportCount");

    if (countEl) countEl.textContent = String(getOpenSupportCount());

    if (!tbody) return;

    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6">No support items found.</td></tr>';
        return;
    }

    tbody.innerHTML = items.map(function(item) {
        const typeClass = item.type === "fraud" ? "pl-negative" : "";
        const msgPreview = item.message.length > 50 ? item.message.slice(0, 50) + "…" : item.message;
        return `<tr>
            <td>${item.date}</td>
            <td>${item.userName}<br><span class="admin-email">${item.userEmail}</span></td>
            <td class="${typeClass}">${formatSupportType(item.type)}</td>
            <td title="${item.message.replace(/"/g, "&quot;")}">${item.subject}<br><span class="admin-email">${msgPreview}</span></td>
            <td class="${supportStatusClass(item.status)}">${item.status}</td>
            <td class="admin-row-actions">
                <button type="button" class="admin-mini-view admin-support-view"
                    data-email="${item.userEmail}" data-id="${item.id}">View / Reply</button>
            </td>
        </tr>`;
    }).join("");
}

function openSupportModal(email, ticketId) {
    const items = getAllSupportItems("all");
    const item = items.find(function(i) {
        return i.userEmail === email && String(i.id) === String(ticketId);
    });
    if (!item) return;

    pendingSupport = { email: email, ticketId: ticketId };
    document.getElementById("supportModalTitle").textContent =
        formatSupportType(item.type) + " — " + item.subject;
    document.getElementById("supportModalMeta").innerHTML =
        "<strong>User:</strong> " + item.userName + " (" + item.userEmail + ")<br>" +
        "<strong>Status:</strong> " + item.status + " · <strong>Date:</strong> " + item.date;
    document.getElementById("supportModalMessage").textContent = item.message;

    const thread = document.getElementById("supportModalThread");
    if (!item.responses || !item.responses.length) {
        thread.innerHTML = '<p class="admin-empty">No responses yet.</p>';
    } else {
        thread.innerHTML = item.responses.map(function(r) {
            return `<div class="admin-support-reply ${r.from === "admin" ? "admin-reply" : "user-reply"}">
                <strong>${r.from === "admin" ? "Admin" : "User"}</strong>
                <div>${r.message.replace(/\n/g, "<br>")}</div>
                <div class="ticket-meta">${r.date}</div>
            </div>`;
        }).join("");
    }

    document.getElementById("supportResponseInput").value = "";
    document.getElementById("supportModal").classList.remove("hidden");
}

function closeSupportModal() {
    document.getElementById("supportModal").classList.add("hidden");
    pendingSupport = { email: "", ticketId: "" };
}

function renderUsersTable(admin, allUsers) {
    const usersBody = document.getElementById("usersBody");
    const countLabel = document.getElementById("userCountLabel");
    const users = getFilteredUsers();
    const totalUsers = allUsers.length;
    const storedCount = getRegisteredAccountCount();

    if (countLabel) {
        const linkedCount = admin.registeredUsers
            ? Object.keys(admin.registeredUsers).length
            : totalUsers;
        countLabel.textContent = userSearchQuery
            ? "Showing " + users.length + " of " + linkedCount + " linked accounts"
            : linkedCount + " account" + (linkedCount === 1 ? "" : "s") +
                " automatically linked · refreshes live";
        if (storedCount > linkedCount) {
            countLabel.textContent += " · " + storedCount + " found in browser storage";
        }
    }

    let hintEl = document.getElementById("adminUserStorageHint");
    if (hintEl) {
        const canonicalHint = typeof isCanonicalAppOrigin === "function" && !isCanonicalAppOrigin()
            ? " Warning: open admin at http://localhost:8765/admin.html so it shares browser storage with user registration."
            : "";
        if (storedCount === 0) {
            hintEl.innerHTML = "No accounts in this browser yet. Users must register at " +
                "<code>http://localhost:8765/login.html</code> via <code>./start.sh</code> " +
                "(accounts sync to the server registry automatically)." + canonicalHint;
        } else if (userSearchQuery && !users.length) {
            const diagnosis = typeof diagnoseAccountEmail === "function"
                ? diagnoseAccountEmail(userSearchQuery)
                : null;
            if (diagnosis && diagnosis.found) {
                hintEl.textContent = "Account found in storage but filtered out. Click Clear search.";
            } else if (diagnosis && !diagnosis.found && isValidEmail(normalizeEmail(userSearchQuery))) {
                hintEl.textContent = "No account for \"" + userSearchQuery + "\" in this browser at " +
                    window.location.origin + ". Registration and admin must use the same origin." + canonicalHint;
            } else {
                hintEl.textContent = "No users match your search. Click Clear search to see all accounts.";
            }
        } else {
            hintEl.textContent = "Storage: " + window.location.origin +
                " · " + storedCount + " account" + (storedCount === 1 ? "" : "s") +
                " (server + browser registry)" + canonicalHint;
        }
    }

    if (!usersBody) return;

    if (!users.length) {
        usersBody.innerHTML = '<tr><td colspan="9">' +
            (totalUsers ? "No users match your search." : "No users registered yet.") +
            '</td></tr>';
        return;
    }

    usersBody.innerHTML = users.map(function(u) {
        return `<tr>
            <td>${u.name}</td>
            <td><span class="admin-email">${u.email}</span><br><span class="admin-email">${u.phone}</span></td>
            <td><span class="admin-status-chip">${formatUserStatus(u)}</span></td>
            <td>${formatMoney(u.cash)}</td>
            <td class="admin-holdings-cell">${u.holdingsSummary}</td>
            <td>${formatLastLogin(u)}</td>
            <td>${formatPendingSummary(u)}</td>
            <td>${u.transactionCount}</td>
            <td class="admin-row-actions">
                <button type="button" class="admin-mini-view" data-email="${u.email}">Monitor</button>
                <button type="button" class="admin-mini-credit" data-email="${u.email}" data-name="${u.name}">Credit</button>
                <button type="button" class="admin-mini-debit" data-email="${u.email}" data-name="${u.name}">Debit</button>
            </td>
        </tr>`;
    }).join("");
}

function renderDashboard() {
    const doRender = function() {
        repairAccountsStorage();
        const admin = getAdminData();
        const allUsers = getAllUsersSummary();

    document.getElementById("totalUsers").textContent = String(allUsers.length);
    renderUsersTable(admin, allUsers);

    const payments = admin.payments || [];
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    payments.forEach(function(p) {
        if (p.type === "deposit") totalDeposits += p.amount;
        if (p.type === "withdraw") totalWithdrawals += p.amount;
    });

    document.getElementById("adminBalance").textContent = formatMoney(admin.balance || 0);
    document.getElementById("adminBalance").className =
        "balance " + ((admin.balance || 0) >= 0 ? "pl-positive" : "pl-negative");
    document.getElementById("totalDeposits").textContent = formatMoney(totalDeposits);
    document.getElementById("totalWithdrawals").textContent = formatMoney(totalWithdrawals);

    populateUserSelects();
    renderActivityFeed();
    renderPendingDepositsAdmin();
    renderPendingTransfersAdmin();
    loadWalletSettings();
    loadWebsiteSettingsForm();
    renderNotificationLog();
    renderSupportAdmin();

    const paymentsBody = document.getElementById("paymentsBody");
    if (!payments.length) {
        paymentsBody.innerHTML = '<tr><td colspan="5">No payments recorded yet.</td></tr>';
    } else {
        paymentsBody.innerHTML = payments.map(function(p) {
            const positive = isPositivePayment(p.type);
            const typeClass = positive ? "pl-positive" : "pl-negative";
            const sign = positive ? "+" : "−";
            return `<tr>
                <td>${p.date}</td>
                <td>${p.userName}<br><span class="admin-email">${p.userEmail}</span></td>
                <td class="${typeClass}">${formatPaymentType(p.type)}</td>
                <td>${p.method}</td>
                <td class="${typeClass}">${sign}${formatMoney(p.amount)}</td>
            </tr>`;
        }).join("");
    }
    };

    if (typeof pullAccountsFromServer !== "function") {
        doRender();
        return;
    }

    pullAccountsFromServer().then(doRender).catch(doRender);
}

function runAdjustment(email, action, amount, note) {
    const result = adminAdjustUserBalance(email, action, amount, note);
    if (!result.ok) {
        alert(result.error);
        return false;
    }
    renderDashboard();
    return true;
}

function submitMainForm(action) {
    const email = document.getElementById("adjustUser").value;
    const amount = document.getElementById("adjustAmount").value;
    const note = document.getElementById("adjustNote").value;

    if (!email) {
        alert("Please select a user.");
        return;
    }

    if (runAdjustment(email, action, amount, note)) {
        document.getElementById("adjustAmount").value = "";
        document.getElementById("adjustNote").value = "";
    }
}

function openAdjustModal(email, name, action) {
    pendingAdjust = { email: email, action: action };
    document.getElementById("adjustModalTitle").textContent =
        action === "credit" ? "+ Credit Account" : "− Debit Account";
    document.getElementById("adjustModalUser").textContent = name + " (" + email + ")";
    document.getElementById("modalAdjustAmount").value = "";
    document.getElementById("modalAdjustNote").value = "";
    document.getElementById("adjustModal").classList.remove("hidden");
    document.getElementById("modalAdjustAmount").focus();
}

function closeAdjustModal() {
    document.getElementById("adjustModal").classList.add("hidden");
    pendingAdjust = { email: "", action: "" };
}

renderDashboard();

document.getElementById("userSearchInput").addEventListener("input", function(e) {
    userSearchQuery = e.target.value.trim();
    renderDashboard();
});

document.getElementById("clearUserSearchBtn").addEventListener("click", function() {
    userSearchQuery = "";
    document.getElementById("userSearchInput").value = "";
    renderDashboard();
});

document.getElementById("refreshUsersBtn").addEventListener("click", function() {
    const finish = function() {
        const report = repairAccountsStorage();
        getAdminData();
        renderDashboard();
        if (report.repaired.length || report.removed.length || report.merged.length) {
            alert("Account registry repaired.\n" +
                (report.repaired.length ? "Fixed: " + report.repaired.join(", ") + "\n" : "") +
                (report.merged.length ? "Merged: " + report.merged.join(", ") + "\n" : "") +
                (report.removed.length ? "Removed invalid: " + report.removed.join(", ") : ""));
        }
    };
    if (typeof pullAccountsFromServer === "function") {
        pullAccountsFromServer().then(finish).catch(finish);
    } else {
        finish();
    }
});

const repairUsersBtn = document.getElementById("repairUsersBtn");
if (repairUsersBtn) {
    repairUsersBtn.addEventListener("click", function() {
        const finish = function() {
            const report = repairAccountsStorage();
            if (typeof importLocalAccountsToServer === "function") {
                importLocalAccountsToServer().then(function() {
                    getAdminData();
                    renderDashboard();
                    alert("Repair complete.\nAccounts: " + getRegisteredAccountCount() +
                        (report.incomplete.length ? "\nIncomplete: " + report.incomplete.join(", ") : ""));
                });
                return;
            }
            getAdminData();
            renderDashboard();
            alert("Repair complete.\nAccounts: " + getRegisteredAccountCount());
        };
        if (typeof pullAccountsFromServer === "function") {
            pullAccountsFromServer().then(finish).catch(finish);
        } else {
            finish();
        }
    });
}

window.addEventListener("globalvest-registry-synced", renderDashboard);

document.getElementById("activityFilter").addEventListener("change", renderActivityFeed);

document.getElementById("supportFilter").addEventListener("change", renderSupportAdmin);

document.getElementById("supportBody").addEventListener("click", function(e) {
    const btn = e.target.closest(".admin-support-view");
    if (btn) openSupportModal(btn.dataset.email, btn.dataset.id);
});

document.getElementById("supportCloseBtn").addEventListener("click", closeSupportModal);

document.getElementById("supportModal").addEventListener("click", function(e) {
    if (e.target === document.getElementById("supportModal")) closeSupportModal();
});

document.getElementById("supportSendBtn").addEventListener("click", function() {
    if (!pendingSupport.email) return;
    const response = document.getElementById("supportResponseInput").value;
    const result = adminRespondToSupport(pendingSupport.email, pendingSupport.ticketId, response, false);
    if (!result.ok) { alert(result.error); return; }
    alert("Response sent to user.");
    closeSupportModal();
    renderDashboard();
});

document.getElementById("supportResolveBtn").addEventListener("click", function() {
    if (!pendingSupport.email) return;
    const response = document.getElementById("supportResponseInput").value.trim();
    const result = response
        ? adminRespondToSupport(pendingSupport.email, pendingSupport.ticketId, response, true)
        : adminResolveSupport(pendingSupport.email, pendingSupport.ticketId);
    if (!result.ok) { alert(result.error); return; }
    alert("Ticket marked resolved and user notified.");
    closeSupportModal();
    renderDashboard();
});

document.getElementById("creditBtn").addEventListener("click", function() {
    submitMainForm("credit");
});

document.getElementById("debitBtn").addEventListener("click", function() {
    submitMainForm("debit");
});

document.getElementById("adjustForm").addEventListener("submit", function(e) {
    e.preventDefault();
});

document.getElementById("modalAdjustConfirm").addEventListener("click", function() {
    if (!pendingAdjust.email) return;
    const amount = document.getElementById("modalAdjustAmount").value;
    const note = document.getElementById("modalAdjustNote").value;
    if (runAdjustment(pendingAdjust.email, pendingAdjust.action, amount, note)) {
        closeAdjustModal();
    }
});

document.getElementById("modalAdjustCancel").addEventListener("click", closeAdjustModal);

document.getElementById("adjustModal").addEventListener("click", function(e) {
    if (e.target === document.getElementById("adjustModal")) {
        closeAdjustModal();
    }
});

document.getElementById("monitorCloseBtn").addEventListener("click", closeMonitorModal);

document.getElementById("monitorModal").addEventListener("click", function(e) {
    if (e.target === document.getElementById("monitorModal")) {
        closeMonitorModal();
    }
});

document.getElementById("usersBody").addEventListener("click", function(e) {
    const viewBtn = e.target.closest(".admin-mini-view");
    const creditBtn = e.target.closest(".admin-mini-credit");
    const debitBtn = e.target.closest(".admin-mini-debit");
    if (viewBtn) {
        openMonitorModal(viewBtn.dataset.email);
    }
    if (creditBtn) {
        openAdjustModal(creditBtn.dataset.email, creditBtn.dataset.name, "credit");
    }
    if (debitBtn) {
        openAdjustModal(debitBtn.dataset.email, debitBtn.dataset.name, "debit");
    }
});

document.getElementById("pendingTransfersBody").addEventListener("click", function(e) {
    const approveBtn = e.target.closest(".admin-approve-btn");
    const rejectBtn = e.target.closest(".admin-reject-btn");

    if (approveBtn && !approveBtn.classList.contains("admin-approve-deposit")) {
        const result = approveTransfer(approveBtn.dataset.id);
        if (!result.ok) { alert(result.error); return; }
        alert("Transfer approved — user debited and confirmation email sent.");
        renderDashboard();
    }

    if (rejectBtn && !rejectBtn.classList.contains("admin-reject-deposit")) {
        const reason = prompt("Rejection reason (optional):");
        if (reason === null) return;
        const result = rejectTransfer(rejectBtn.dataset.id, reason.trim());
        if (!result.ok) { alert(result.error); return; }
        alert("Transfer rejected — user notified by email.");
        renderDashboard();
    }
});

document.getElementById("pendingDepositsBody").addEventListener("click", function(e) {
    const approveBtn = e.target.closest(".admin-approve-deposit");
    const rejectBtn = e.target.closest(".admin-reject-deposit");

    if (approveBtn) {
        const result = approveDeposit(approveBtn.dataset.id);
        if (!result.ok) { alert(result.error); return; }
        alert("Deposit approved — user account credited and confirmation email sent.");
        renderDashboard();
    }

    if (rejectBtn) {
        const reason = prompt("Rejection reason (optional):");
        if (reason === null) return;
        const result = rejectDeposit(rejectBtn.dataset.id, reason.trim());
        if (!result.ok) { alert(result.error); return; }
        alert("Deposit rejected — user notified by email.");
        renderDashboard();
    }
});

document.getElementById("walletSettingsForm").addEventListener("submit", function(e) {
    e.preventDefault();
    updateAdminPaymentSettings(
        document.getElementById("adminWalletInput").value,
        document.getElementById("adminBankInput").value
    );
    alert("Admin wallet and bank settings saved.");
    renderDashboard();
});

document.getElementById("websiteSettingsForm").addEventListener("submit", function(e) {
    e.preventDefault();
    updateWebsiteSettings({
        siteName: document.getElementById("siteNameInput").value,
        siteTagline: document.getElementById("siteTaglineInput").value,
        supportEmail: document.getElementById("supportEmailInput").value,
        announcement: document.getElementById("announcementInput").value,
        maintenanceMode: document.getElementById("maintenanceModeInput").checked
    });
    applyWebsiteSettings();
    alert("Website settings saved.");
    renderDashboard();
});

document.getElementById("notificationForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const target = document.getElementById("notifTarget").value;
    const message = document.getElementById("notifMessage").value;
    const result = sendAdminNotification(target, message);
    if (!result.ok) {
        alert(result.error);
        return;
    }
    document.getElementById("notifMessage").value = "";
    alert("Notification sent to " + result.count + " user" + (result.count === 1 ? "" : "s") + ".");
    renderDashboard();
});

document.getElementById("adminLogoutBtn").addEventListener("click", function() {
    clearAdminSession();
    window.location.href = getLocalServerUrl("admin.html");
});

window.addEventListener("storage", function(e) {
    if (!e.key || e.key === ACCOUNTS_KEY || e.key === ADMIN_DATA_KEY) {
        renderDashboard();
    }
});

window.addEventListener("globalvest-accounts-changed", renderDashboard);

document.addEventListener("visibilitychange", function() {
    if (!document.hidden) renderDashboard();
});

window.addEventListener("focus", renderDashboard);

setInterval(renderDashboard, 2000);
})();
