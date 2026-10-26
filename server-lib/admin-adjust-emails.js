const { sendTransactionalEmail } = require("./resend");
const {
    buildTransactionalEmailContent,
    getSupportEmail,
    BRAND_NAME
} = require("./email-deliverability");

const LOG_PREFIX = "[admin-adjust-email]";

function getDisplayName(account, email) {
    if (account && account.profile && account.profile.fullName) {
        return account.profile.fullName;
    }
    return email;
}

function getSiteName(admin) {
    if (admin && admin.websiteSettings && admin.websiteSettings.siteName) {
        return admin.websiteSettings.siteName;
    }
    return BRAND_NAME;
}

function buildAdminAdjustContent(options) {
    options = options || {};
    const userEmail = String(options.userEmail || "").trim().toLowerCase();
    const action = options.action === "debit" ? "debit" : "credit";
    const amount = Number(options.amount);
    const note = String(options.note || "").trim();
    const account = options.account || {};
    const admin = options.admin || {};
    const siteName = getSiteName(admin);
    const supportEmail = getSupportEmail();
    const fullName = getDisplayName(account, userEmail);
    const balance = Number(account.cash);
    const isCredit = action === "credit";

    const subject = siteName + " — Account " + (isCredit ? "credited" : "debited") +
        " $" + amount.toFixed(2);

    const body =
        "Hi " + fullName + ",\n\n" +
        (isCredit
            ? "An administrator credited your GlobalVest account.\n\n"
            : "An administrator debited your GlobalVest account.\n\n") +
        "Amount: $" + amount.toFixed(2) + "\n" +
        (note ? "Note: " + note + "\n" : "") +
        "Updated cash balance: $" + balance.toFixed(2) + "\n" +
        "Date: " + new Date().toLocaleString() + "\n\n" +
        "Log in to view your transaction history.\n\n" +
        (isCredit
            ? ""
            : "If you did not expect this debit, contact " + supportEmail + " immediately.\n\n") +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        category: isCredit ? "admin-credit" : "admin-debit",
        headline: isCredit ? "Account credited" : "Account debited"
    };
}

async function sendAdminAdjustEmailSafely(options) {
    options = options || {};
    const userEmail = String(options.userEmail || "").trim().toLowerCase();
    if (!userEmail || userEmail.indexOf("@") === -1) {
        return { sent: false, skipped: true, error: "Missing user email." };
    }

    const amount = Number(options.amount);
    if (!amount || amount <= 0) {
        return { sent: false, skipped: true, error: "Invalid adjustment amount." };
    }

    const content = buildAdminAdjustContent(options);
    const wrapped = buildTransactionalEmailContent(
        content.subject,
        content.body,
        userEmail,
        {
            category: content.category,
            headline: content.headline,
            referenceId: "gv-admin-adjust-" + userEmail.replace(/[^a-z0-9@._-]/gi, "")
        }
    );

    console.log(LOG_PREFIX, "attempt", {
        to: userEmail,
        action: options.action,
        amount: amount
    });

    try {
        const data = await sendTransactionalEmail({
            to: userEmail,
            subject: wrapped.subject,
            text: wrapped.text,
            html: wrapped.html,
            headers: wrapped.headers,
            tags: wrapped.tags
        });
        console.log(LOG_PREFIX, "sent", {
            to: userEmail,
            id: data && data.id ? data.id : null
        });
        return { sent: true, id: data && data.id ? data.id : null };
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(LOG_PREFIX, "failed", { to: userEmail, error: message });
        return { sent: false, error: message };
    }
}

module.exports = {
    buildAdminAdjustContent,
    sendAdminAdjustEmailSafely
};
