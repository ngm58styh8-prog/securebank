const { sendTransactionalEmail } = require("./resend");
const {
    buildTransactionalEmailContent,
    getSupportEmail,
    BRAND_NAME
} = require("./email-deliverability");
const { buildDepositConfirmationContent } = require("./deposit-emails");

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
    const reference = String(options.reference || options.transactionReference || "").trim();

    if (isCredit) {
        const depositContent = buildDepositConfirmationContent({
            userEmail: userEmail,
            account: account,
            admin: admin,
            amount: amount,
            balance: balance,
            currency: "USD",
            reference: reference,
            depositSource: note || "Verified account credit",
            completedAt: options.completedAt || new Date().toISOString()
        });
        return {
            subject: depositContent.subject,
            body: depositContent.body,
            category: "admin-credit",
            headline: depositContent.headline
        };
    }

    const subject = siteName + " — Account debited $" + amount.toFixed(2);
    const body =
        "Hi " + fullName + ",\n\n" +
        "A verified adjustment was applied to your GlobalVest account.\n\n" +
        "Amount: $" + amount.toFixed(2) + "\n" +
        (note ? "Reason: " + note + "\n" : "") +
        (reference ? "Transaction Reference: " + reference + "\n" : "") +
        "Updated available balance: $" + balance.toFixed(2) + "\n" +
        "Date: " + new Date().toLocaleString() + "\n\n" +
        "Log in to view your transaction history.\n\n" +
        "If you did not expect this debit, contact " + supportEmail + " immediately.\n\n" +
        "Thank you,\n" + siteName;

    return {
        subject: subject,
        body: body,
        category: "admin-debit",
        headline: "Account debited"
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
    const referenceTag = options.reference
        ? String(options.reference).replace(/[^a-z0-9_-]/gi, "")
        : ("gv-admin-adjust-" + userEmail.replace(/[^a-z0-9@._-]/gi, ""));
    const wrapped = buildTransactionalEmailContent(
        content.subject,
        content.body,
        userEmail,
        {
            category: content.category,
            headline: content.headline,
            referenceId: referenceTag
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
