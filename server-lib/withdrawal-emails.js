const { sendTransactionalEmail } = require("./resend");
const {
    buildTransactionalEmailContent,
    getSupportEmail,
    BRAND_NAME
} = require("./email-deliverability");

const LOG_PREFIX = "[withdrawal-email]";

function formatWithdrawalMethod(method) {
    if (method === "crypto") return "Cryptocurrency";
    if (method === "bank") return "Bank Transfer";
    if (method === "wire") return "Wire Transfer";
    return method || "Withdrawal";
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
        transferId: context && context.transferId ? context.transferId : null
    });
}

function logEmailSuccess(type, to, data, context) {
    console.log(LOG_PREFIX, "sent", {
        type: type,
        to: to,
        id: data && data.id ? data.id : null,
        transferId: context && context.transferId ? context.transferId : null
    });
}

function logEmailFailure(type, to, error, context) {
    console.error(LOG_PREFIX, "failed", {
        type: type,
        to: to,
        transferId: context && context.transferId ? context.transferId : null,
        error: error && error.message ? error.message : String(error || "Unknown error")
    });
}

function buildWithdrawalReceivedContent(transfer, account, admin) {
    const userEmail = transfer.userEmail;
    const siteName = getSiteName(admin);
    const fullName = getUserDisplayName(account, userEmail);
    const supportEmail = getSupportEmail();
    const methodLabel = formatWithdrawalMethod(transfer.method);
    const amount = Number(transfer.amount);
    const destination = transfer.destination || "your linked account";
    const submittedAt = formatDateTime(transfer.requestedAt || transfer.date);

    const subject = siteName + " — Withdrawal Request Received ($" + amount.toFixed(2) + ")";
    const body = "Hi " + fullName + ",\n\n" +
        "We received your withdrawal request for $" + amount.toFixed(2) + " via " + methodLabel +
        " to " + destination + ".\n\n" +
        "Status: Pending admin approval\n" +
        "Submitted: " + submittedAt + "\n\n" +
        "You will receive another email once your withdrawal is processed.\n\n" +
        "If you did not submit this request, contact us immediately at " + supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        headline: "Withdrawal Request Received"
    };
}

function buildWithdrawalProcessedContent(transfer, account, admin) {
    const userEmail = transfer.userEmail;
    const siteName = getSiteName(admin);
    const fullName = getUserDisplayName(account, userEmail);
    const supportEmail = getSupportEmail();
    const methodLabel = formatWithdrawalMethod(transfer.method);
    const amount = Number(transfer.amount);
    const destination = transfer.destination || "your linked account";
    const balance = Number(account && account.cash != null ? account.cash : 0);
    const processedAt = formatDateTime(transfer.resolvedAt || new Date().toISOString());

    const subject = siteName + " — Withdrawal Processed ($" + amount.toFixed(2) + ")";
    const body = "Hi " + fullName + ",\n\n" +
        "Your withdrawal of $" + amount.toFixed(2) + " via " + methodLabel +
        " to " + destination + " has been approved and processed.\n\n" +
        "Amount withdrawn: $" + amount.toFixed(2) + "\n" +
        "Updated cash balance: $" + balance.toFixed(2) + "\n" +
        "Date: " + processedAt + "\n\n" +
        "Log in to GlobalVest to view your transaction history.\n\n" +
        "If you did not authorize this withdrawal, contact us immediately at " + supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        headline: "Withdrawal Processed"
    };
}

function buildWithdrawalDeclinedContent(transfer, account, admin, reason) {
    const userEmail = transfer.userEmail;
    const siteName = getSiteName(admin);
    const fullName = getUserDisplayName(account, userEmail);
    const supportEmail = getSupportEmail();
    const amount = Number(transfer.amount);
    const destination = transfer.destination || "your linked account";
    const declinedAt = formatDateTime(transfer.resolvedAt || new Date().toISOString());
    const rejectionReason = String(reason || transfer.rejectReason || "Rejected by admin").trim();

    const subject = siteName + " — Withdrawal Declined ($" + amount.toFixed(2) + ")";
    const body = "Hi " + fullName + ",\n\n" +
        "Your withdrawal request for $" + amount.toFixed(2) + " to " + destination +
        " was not approved.\n\n" +
        "Reason: " + rejectionReason + "\n" +
        "Date: " + declinedAt + "\n\n" +
        "Your balance was not changed. If you have questions, contact " + supportEmail + ".\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        headline: "Withdrawal Declined"
    };
}

async function sendWithdrawalEmail(type, transfer, account, admin, buildContent, sentAtField) {
    const to = String(transfer && transfer.userEmail || "").trim().toLowerCase();
    const context = { transferId: transfer && transfer.id ? transfer.id : null };

    if (!to || to.indexOf("@") === -1) {
        logEmailFailure(type, to || "(missing)", new Error("Missing recipient email."), context);
        return { sent: false, skipped: true, error: "Missing recipient email." };
    }

    if (sentAtField && transfer[sentAtField]) {
        console.log(LOG_PREFIX, "skipped-duplicate", {
            type: type,
            to: to,
            transferId: context.transferId,
            sentAt: transfer[sentAtField]
        });
        return { sent: false, skipped: true, duplicate: true };
    }

    const content = buildContent(transfer, account, admin);
    logEmailAttempt(type, to, context);

    try {
        const emailContent = buildTransactionalEmailContent(
            content.subject,
            content.body,
            to,
            {
                category: "withdrawal-" + type,
                headline: content.headline,
                referenceId: "gv-withdrawal-" + String(transfer.id || type)
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

async function sendWithdrawalReceivedEmailSafely(transfer, account, admin) {
    return sendWithdrawalEmail(
        "received",
        transfer,
        account,
        admin,
        buildWithdrawalReceivedContent,
        "submittedEmailSentAt"
    );
}

async function sendWithdrawalProcessedEmailSafely(transfer, account, admin) {
    return sendWithdrawalEmail(
        "processed",
        transfer,
        account,
        admin,
        buildWithdrawalProcessedContent,
        "approvedEmailSentAt"
    );
}

async function sendWithdrawalDeclinedEmailSafely(transfer, account, admin, reason) {
    const to = String(transfer && transfer.userEmail || "").trim().toLowerCase();
    const context = { transferId: transfer && transfer.id ? transfer.id : null };

    if (transfer.rejectedEmailSentAt) {
        console.log(LOG_PREFIX, "skipped-duplicate", {
            type: "declined",
            to: to,
            transferId: context.transferId,
            sentAt: transfer.rejectedEmailSentAt
        });
        return { sent: false, skipped: true, duplicate: true };
    }

    return sendWithdrawalEmail(
        "declined",
        transfer,
        account,
        admin,
        function(tx, acc, adm) {
            return buildWithdrawalDeclinedContent(tx, acc, adm, reason);
        },
        null
    );
}

module.exports = {
    LOG_PREFIX,
    formatWithdrawalMethod,
    buildWithdrawalReceivedContent,
    buildWithdrawalProcessedContent,
    buildWithdrawalDeclinedContent,
    sendWithdrawalReceivedEmailSafely,
    sendWithdrawalProcessedEmailSafely,
    sendWithdrawalDeclinedEmailSafely
};
