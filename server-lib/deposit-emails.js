const { sendTransactionalEmail } = require("./resend");
const {
    buildTransactionalEmailContent,
    getSupportEmail,
    BRAND_NAME
} = require("./email-deliverability");

const LOG_PREFIX = "[deposit-email]";

function formatDepositMethod(method) {
    if (method === "crypto") return "Cryptocurrency";
    if (method === "bank") return "Bank Transfer";
    if (method === "card") return "Card";
    return method || "Deposit";
}

function formatDateTime(value) {
    if (value) {
        try {
            return new Date(value).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short"
            });
        } catch (e) {
            return String(value);
        }
    }
    return new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
    });
}

function getUserDisplayName(account, userEmail) {
    if (account && account.profile && account.profile.fullName) {
        return account.profile.fullName;
    }
    if (account && account.profile && account.profile.name) {
        return account.profile.name;
    }
    return userEmail;
}

function getSiteName(admin) {
    if (admin && admin.websiteSettings && admin.websiteSettings.siteName) {
        return admin.websiteSettings.siteName;
    }
    return BRAND_NAME;
}

function logEmailAttempt(type, to, context) {
    console.log(LOG_PREFIX, "attempt", {
        type: type,
        to: to,
        depositId: context && context.depositId ? context.depositId : null
    });
}

function logEmailSuccess(type, to, data, context) {
    console.log(LOG_PREFIX, "sent", {
        type: type,
        to: to,
        id: data && data.id ? data.id : null,
        depositId: context && context.depositId ? context.depositId : null
    });
}

function logEmailFailure(type, to, error, context) {
    console.error(LOG_PREFIX, "failed", {
        type: type,
        to: to,
        depositId: context && context.depositId ? context.depositId : null,
        error: error && error.message ? error.message : String(error || "Unknown error")
    });
}

function buildDepositReceivedContent(deposit, account, admin) {
    const userEmail = deposit.userEmail;
    const siteName = getSiteName(admin);
    const fullName = getUserDisplayName(account, userEmail);
    const supportEmail = getSupportEmail();
    const methodLabel = formatDepositMethod(deposit.method);
    const amount = Number(deposit.amount);
    const submittedAt = formatDateTime(deposit.requestedAt || deposit.date);

    const subject = siteName + " — Deposit Request Received ($" + amount.toFixed(2) + ")";
    let body = "Hi " + fullName + ",\n\n" +
        "We received your deposit request for $" + amount.toFixed(2) + " via " + methodLabel + ".\n\n" +
        "Status: Pending admin approval\n" +
        "Submitted: " + submittedAt + "\n\n";

    if (deposit.method === "crypto" && deposit.payTo) {
        body += "Send your payment to this address:\n" + deposit.payTo + "\n\n";
    }

    body += "You will receive another email once your deposit is approved and credited.\n\n" +
        "Questions? Contact " + supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        headline: "Deposit Request Received"
    };
}

function buildDepositCreditedContent(deposit, account, admin) {
    const userEmail = deposit.userEmail;
    const siteName = getSiteName(admin);
    const fullName = getUserDisplayName(account, userEmail);
    const supportEmail = getSupportEmail();
    const methodLabel = formatDepositMethod(deposit.method);
    const amount = Number(deposit.amount);
    const balance = Number(account && account.cash != null ? account.cash : 0);
    const creditedAt = formatDateTime(deposit.resolvedAt || new Date().toISOString());

    const subject = siteName + " — Deposit Credited ($" + amount.toFixed(2) + ")";
    const body = "Hi " + fullName + ",\n\n" +
        "Your deposit of $" + amount.toFixed(2) + " via " + methodLabel +
        " has been approved and credited to your account.\n\n" +
        "Amount credited: $" + amount.toFixed(2) + "\n" +
        "Updated cash balance: $" + balance.toFixed(2) + "\n" +
        "Date: " + creditedAt + "\n\n" +
        "Log in to GlobalVest to view your updated balance and transaction history.\n\n" +
        "If you did not make this deposit, contact us immediately at " + supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        headline: "Deposit Credited"
    };
}

function buildDepositDeclinedContent(deposit, account, admin, reason) {
    const userEmail = deposit.userEmail;
    const siteName = getSiteName(admin);
    const fullName = getUserDisplayName(account, userEmail);
    const supportEmail = getSupportEmail();
    const methodLabel = formatDepositMethod(deposit.method);
    const amount = Number(deposit.amount);
    const declinedAt = formatDateTime(deposit.resolvedAt || new Date().toISOString());
    const rejectionReason = String(reason || deposit.rejectReason || "Rejected by admin").trim();

    const subject = siteName + " — Deposit Declined ($" + amount.toFixed(2) + ")";
    const body = "Hi " + fullName + ",\n\n" +
        "Your deposit request for $" + amount.toFixed(2) + " via " + methodLabel +
        " was not approved.\n\n" +
        "Reason: " + rejectionReason + "\n" +
        "Date: " + declinedAt + "\n\n" +
        "No funds were added to your account. If you believe this was a mistake, contact " +
        supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        headline: "Deposit Declined"
    };
}

async function sendDepositEmail(type, deposit, account, admin, buildContent, sentAtField) {
    const to = String(deposit && deposit.userEmail || "").trim().toLowerCase();
    const context = { depositId: deposit && deposit.id ? deposit.id : null };

    if (!to || to.indexOf("@") === -1) {
        logEmailFailure(type, to || "(missing)", new Error("Missing recipient email."), context);
        return { sent: false, skipped: true, error: "Missing recipient email." };
    }

    if (sentAtField && deposit[sentAtField]) {
        console.log(LOG_PREFIX, "skipped-duplicate", {
            type: type,
            to: to,
            depositId: context.depositId,
            sentAt: deposit[sentAtField]
        });
        return { sent: false, skipped: true, duplicate: true };
    }

    const content = buildContent(deposit, account, admin);
    logEmailAttempt(type, to, context);

    try {
        const emailContent = buildTransactionalEmailContent(
            content.subject,
            content.body,
            to,
            {
                category: "deposit-" + type,
                headline: content.headline
            }
        );

        const data = await sendTransactionalEmail({
            to: to,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
            headers: emailContent.headers,
            tags: emailContent.tags
        });

        logEmailSuccess(type, to, data, context);
        return { sent: true, id: data && data.id ? data.id : null };
    } catch (err) {
        logEmailFailure(type, to, err, context);
        return { sent: false, error: err && err.message ? err.message : String(err) };
    }
}

async function sendDepositReceivedEmailSafely(deposit, account, admin) {
    if (deposit && deposit.status && deposit.status !== "pending") {
        console.log(LOG_PREFIX, "skipped-non-pending", {
            type: "received",
            to: deposit.userEmail,
            depositId: deposit.id,
            status: deposit.status
        });
        return { sent: false, skipped: true, duplicate: true };
    }

    return sendDepositEmail(
        "received",
        deposit,
        account,
        admin,
        buildDepositReceivedContent,
        "submittedEmailSentAt"
    );
}

async function sendDepositCreditedEmailSafely(deposit, account, admin) {
    return sendDepositEmail(
        "credited",
        deposit,
        account,
        admin,
        buildDepositCreditedContent,
        "approvedEmailSentAt"
    );
}

async function sendDepositDeclinedEmailSafely(deposit, account, admin, reason) {
    const to = String(deposit && deposit.userEmail || "").trim().toLowerCase();
    const context = { depositId: deposit && deposit.id ? deposit.id : null };

    if (deposit.rejectedEmailSentAt) {
        console.log(LOG_PREFIX, "skipped-duplicate", {
            type: "declined",
            to: to,
            depositId: context.depositId,
            sentAt: deposit.rejectedEmailSentAt
        });
        return { sent: false, skipped: true, duplicate: true };
    }

    return sendDepositEmail(
        "declined",
        deposit,
        account,
        admin,
        function(dep, acc, adm) {
            return buildDepositDeclinedContent(dep, acc, adm, reason);
        },
        null
    );
}

module.exports = {
    LOG_PREFIX,
    formatDepositMethod,
    formatDateTime,
    buildDepositReceivedContent,
    buildDepositCreditedContent,
    buildDepositDeclinedContent,
    sendDepositReceivedEmailSafely,
    sendDepositCreditedEmailSafely,
    sendDepositDeclinedEmailSafely
};
