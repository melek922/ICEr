const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(__dirname));

// ⚠️ Environment Configurations
const BOT_TOKEN = process.env.BOT_TOKEN || '8897397930:AAG253KLBS1y-KXEqw5Xf6sSpv0Ylx0LxHY';
const ADMIN_IDS = (process.env.ADMIN_IDS || '5569487012').split(',').map(id => id.trim());
const WEB_URL = process.env.WEB_URL || `http://localhost:${PORT}`;
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://ice-core.vercel.app';
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || '';
const BOT_USERNAME = process.env.BOT_USERNAME || 'ice_registration_bot';
const TELEBIRR_NUMBER = process.env.TELEBIRR_NUMBER || '0941550511';
const TELEBIRR_NAME = process.env.TELEBIRR_NAME || 'Nathanael';
const USDT_ADDRESS = process.env.USDT_TRC20_ADDRESS || 'Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// ☁️ Cloudinary Configuration (Server-Side Protected)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'rbkihpxg';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'ice_preset';

async function uploadToCloudinary(base64Data) {
    if (!base64Data || !base64Data.startsWith('data:image')) {
        return base64Data || '';
    }
    try {
        console.log('☁️ Uploading receipt to Cloudinary server-side...');
        const response = await axios.post(
            `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
            {
                file: base64Data,
                upload_preset: CLOUDINARY_UPLOAD_PRESET
            }
        );

        if (response.data && response.data.secure_url) {
            console.log('✅ Cloudinary upload success:', response.data.secure_url);
            return response.data.secure_url;
        }
    } catch (err) {
        console.error('❌ Cloudinary server upload error:', err.response ? err.response.data : err.message);
    }
    return '';
}

// 📁 Local Data Files
const DB_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const LICENSES_FILE = path.join(__dirname, 'licenses.json');

// --- Helper Functions for Data Persistence ---
function loadJSON(file) {
    if (!fs.existsSync(file)) return {};
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`Error reading ${file}:`, e.message);
        return {};
    }
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing ${file}:`, e.message);
    }
}

function loadUsers() { return loadJSON(DB_FILE); }
function saveUsers(users) { saveJSON(DB_FILE, users); }

function loadOrders() { return loadJSON(ORDERS_FILE); }
function saveOrders(orders) { saveJSON(ORDERS_FILE, orders); }

function loadLicenses() { return loadJSON(LICENSES_FILE); }
function saveLicenses(licenses) { saveJSON(LICENSES_FILE, licenses); }

// 🔑 Generate Unique License Key (Format: ITP-XXXXX-XXXXX-XXXXX)
function generateLicenseKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const block = () => {
        let res = '';
        for (let i = 0; i < 5; i++) {
            res += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return res;
    };
    return `ITP-${block()}-${block()}-${block()}`;
}

// 🤖 Telegram API Request Helper
async function sendTelegram(method, data) {
    if (!BOT_TOKEN) {
        console.warn(`[WARN] BOT_TOKEN is missing. Skipping Telegram call (${method})`);
        return null;
    }
    try {
        return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
    } catch (error) {
        console.error(`Telegram API Error (${method}):`, error.response ? error.response.data : error.message);
        return null;
    }
}

// 🔄 Google Sheets 2-Way Sync
async function syncFromGoogleSheets() {
    if (!GOOGLE_SHEET_URL) return;
    try {
        console.log('🔄 Syncing database from Google Sheets...');
        const response = await axios.post(GOOGLE_SHEET_URL, { action: 'get_all_data' });
        if (response.data && response.data.success) {
            const { users, orders } = response.data;
            if (users) {
                const localUsers = loadUsers();
                Object.keys(users).forEach(uid => {
                    localUsers[uid] = { ...localUsers[uid], ...users[uid] };
                });
                saveUsers(localUsers);
            }
            if (orders) {
                const localOrders = loadOrders();
                Object.keys(orders).forEach(oid => {
                    localOrders[oid] = { ...localOrders[oid], ...orders[oid] };
                });
                saveOrders(localOrders);
            }
            console.log('✅ Google Sheets sync complete!');
        }
    } catch (err) {
        console.error('❌ Google Sheets sync failed:', err.message);
    }
}

function syncToGoogle(action, payload) {
    if (!GOOGLE_SHEET_URL) return;
    axios.post(GOOGLE_SHEET_URL, { action, ...payload })
        .then(res => {
            if (res.data && res.data.success === false) {
                console.error(`❌ Google Sheets Action Error (${action}):`, res.data.error);
            }
        })
        .catch(e => console.error(`❌ Google Sheets Network Error (${action}):`, e.message));
}

// -------------------------------------------------------------
// 🌐 API ENDPOINTS (FOR TELEGRAM WEBAPP & WEBSITE INTEGRATION)
// -------------------------------------------------------------

// Config API
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        bot_username: BOT_USERNAME,
        website_url: WEBSITE_URL,
        payment_info: {
            telebirr: { number: TELEBIRR_NUMBER, name: TELEBIRR_NAME },
            usdt_trc20: USDT_ADDRESS
        }
    });
});

// 1. Order Submission API (From WebApp or Website)
app.post('/api/order', async (req, res) => {
    try {
        const {
            user_id,
            name,
            phone,
            email,
            telegram_username,
            broker_wallet_id,
            package_type,
            price,
            payment_method,
            receipt_url,
            tx_ref
        } = req.body;

        const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const timestamp = new Date().toISOString();

        // ☁️ Secure Server-Side Cloudinary Upload
        let finalReceiptUrl = receipt_url || '';
        if (finalReceiptUrl && finalReceiptUrl.startsWith('data:image')) {
            finalReceiptUrl = await uploadToCloudinary(finalReceiptUrl);
        }

        const orderData = {
            order_id: orderId,
            user_id: user_id ? user_id.toString() : 'WEBSITE',
            name: name || 'Student',
            phone: phone || 'N/A',
            email: email || 'N/A',
            telegram_username: telegram_username || 'N/A',
            broker_wallet_id: broker_wallet_id || 'N/A',
            package_type: package_type || 'ICE 35-Day Mastery',
            price: price || '5,999 ETB',
            payment_method: payment_method || 'TELEBIRR',
            receipt_url: finalReceiptUrl,
            tx_ref: tx_ref || 'N/A',
            status: 'PENDING',
            created_at: timestamp
        };

        // Save order locally
        const orders = loadOrders();
        orders[orderId] = orderData;
        saveOrders(orders);

        // Update user record if user_id exists
        if (user_id && user_id !== 'WEBSITE') {
            const users = loadUsers();
            if (!users[user_id]) users[user_id] = {};
            users[user_id].name = name || users[user_id].name;
            users[user_id].phone = phone || users[user_id].phone;
            users[user_id].email = email || users[user_id].email;
            users[user_id].last_order_id = orderId;
            saveUsers(users);
        }

        // Sync to Google Sheets
        syncToGoogle('new_order', orderData);

        // 🔗 Generate Official Live Verification Link
        const cleanTxRef = (orderData.tx_ref || '').trim();
        let verifyUrl = '';
        let verifyLabel = '';

        if (orderData.payment_method === 'TELEBIRR') {
            verifyUrl = `https://transactioninfo.ethiotelecom.et/receipt/${encodeURIComponent(cleanTxRef)}`;
            verifyLabel = '🔍 Verify Telebirr Receipt (Ethio Telecom Live)';
        } else {
            verifyUrl = `https://tronscan.org/#/transaction/${encodeURIComponent(cleanTxRef)}`;
            verifyLabel = '🔍 Verify USDT on Tronscan (Blockchain Live)';
        }

        // 🔔 Notify Admins on Telegram with Instant Inline Action Buttons
        let adminMsg = `🚨 <b>New Payment Verification Request!</b>\n\n` +
            `📦 <b>Package:</b> 💎 <b>${orderData.package_type}</b>\n` +
            `💰 <b>Amount:</b> <b>${orderData.price}</b>\n` +
            `💳 <b>Method:</b> ${orderData.payment_method}\n` +
            `🧾 <b>TxRef / Hash:</b> <code>${orderData.tx_ref}</code>\n` +
            `🌐 <b>Official Receipt:</b> <a href="${verifyUrl}">Click to View Live Receipt</a>\n\n`;

        if (orderData.broker_wallet_id && orderData.broker_wallet_id !== 'N/A') {
            adminMsg += `🏢 <b>Broker Wallet ID:</b> <code>${orderData.broker_wallet_id}</code> (-30% Discount)\n\n`;
        }

        adminMsg += `👤 <b>Name:</b> ${orderData.name}\n` +
            `📞 <b>Phone:</b> <code>${orderData.phone}</code>\n` +
            `📧 <b>Email:</b> <code>${orderData.email}</code>\n` +
            `✈️ <b>Telegram:</b> @${(orderData.telegram_username || '').replace('@', '') || 'N/A'}\n` +
            `🆔 <b>User ID:</b> <code>${orderData.user_id}</code>\n` +
            `🔢 <b>Order ID:</b> <code>${orderId}</code>\n\n` +
            `────────────────────\n` +
            `👉 <i>Check the live receipt above, then click Approve to generate and send the License Key automatically.</i>`;

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: verifyLabel, url: verifyUrl }
                ],
                [
                    { text: '✅ Approve & Send License Key', callback_data: `approve_${orderId}` },
                    { text: '❌ Reject', callback_data: `reject_${orderId}` }
                ],
                [
                    { text: '💬 Send Message to Student', callback_data: `replyprompt_${orderData.user_id}` }
                ]
            ]
        };

        for (const adminId of ADMIN_IDS) {
            let sent = false;
            if (orderData.receipt_url && (orderData.receipt_url.startsWith('http://') || orderData.receipt_url.startsWith('https://'))) {
                const photoRes = await sendTelegram('sendPhoto', {
                    chat_id: adminId,
                    photo: orderData.receipt_url,
                    caption: adminMsg,
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard
                });
                if (photoRes && photoRes.data && photoRes.data.ok) {
                    sent = true;
                }
            }

            if (!sent) {
                await sendTelegram('sendMessage', {
                    chat_id: adminId,
                    text: adminMsg,
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard
                });
            }
        }

        // 📩 Confirmation to Student on Telegram
        if (user_id && user_id !== 'WEBSITE') {
            const customerMsg = `✅ <b>Payment Submitted Successfully! / ክፍያዎ በተሳካ ሁኔታ ተልኳል!</b>\n\n` +
                `🔢 <b>Order ID:</b> <code>${orderId}</code>\n` +
                `📦 <b>Package:</b> ${orderData.package_type}\n` +
                `💰 <b>Amount:</b> ${orderData.price}\n` +
                `🧾 <b>TxRef:</b> <code>${orderData.tx_ref}</code>\n\n` +
                `⏳ <b>EN:</b> Nathanael is verifying your transaction. Your <b>35-Day License Key</b> and website login guide will be sent here on Telegram shortly.\n\n` +
                `⏳ <b>AM:</b> የላኩት መረጃ እየተረጋገጠ ነው። የ <b>35 ቀኑን License Key</b> በአጭር ጊዜ ውስጥ በዚሁ ቴሌግራም ይደርስዎታል።\n\n` +
                `Thank you for choosing ICE Trading Academy! 🚀`;

            await sendTelegram('sendMessage', {
                chat_id: user_id,
                text: customerMsg,
                parse_mode: 'HTML'
            });
        }

        res.status(200).json({ success: true, order_id: orderId });
    } catch (error) {
        console.error('Order Submission Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Direct Website Manual Payment Webhook
app.post('/api/website-payment', async (req, res) => {
    try {
        const { email, txRef, method, amount } = req.body;
        const orderId = `WEB-${Date.now()}`;

        const adminMsg = `🌐 <b>New Payment on Website (ice-core.vercel.app)!</b>\n\n` +
            `📧 <b>Email:</b> <code>${email}</code>\n` +
            `💳 <b>Method:</b> ${method || 'Telebirr/Crypto'}\n` +
            `🧾 <b>TxRef / Hash:</b> <code>${txRef}</code>\n` +
            `💰 <b>Amount:</b> ${amount || '5,999 ETB'}\n` +
            `⏰ <b>Date:</b> ${new Date().toLocaleString()}\n\n` +
            `────────────────────\n` +
            `Approve on Website Dashboard or generate key via bot:\n` +
            `<code>/license ${email}</code>`;

        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: adminMsg,
                parse_mode: 'HTML'
            });
        }

        res.status(200).json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// -------------------------------------------------------------
// 🤖 TELEGRAM BOT WEBHOOK & INTERACTION HANDLER
// -------------------------------------------------------------

const MAIN_KEYBOARD_EN = {
    keyboard: [
        [{ text: "💎 Enroll / Verify Payment (WebApp)", web_app: { url: WEB_URL } }],
        [{ text: "👥 Referral Link" }, { text: "💰 My Balance" }],
        [{ text: "🔑 My License Key" }, { text: "📥 Withdraw Commission" }],
        [{ text: "🌐 Open Website" }, { text: "📞 Support" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
};

// Handle Telegram Updates (Webhook)
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    try {
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
            return;
        }

        if (update.message) {
            await handleMessage(update.message);
            return;
        }
    } catch (err) {
        console.error('Error handling telegram update:', err);
    }
});

// -------------------------------------------------------------
// 👑 CORE ADMIN ACTIONS: APPROVAL, REJECTION & LISTING
// -------------------------------------------------------------

// 1. Process Order Approval (Used by inline buttons and /approve /approved commands)
async function processOrderApproval(identifier, adminId, replyChatId) {
    const orders = loadOrders();
    let orderId = identifier ? identifier.trim() : null;
    let order = null;

    if (orderId && orders[orderId]) {
        order = orders[orderId];
    } else if (orderId) {
        // Search by userId, email, tx_ref, or partial order_id
        const allOrders = Object.values(orders);
        order = allOrders.find(o => 
            (o.user_id && o.user_id.toString() === orderId) ||
            (o.email && o.email.toLowerCase() === orderId.toLowerCase()) ||
            (o.tx_ref && o.tx_ref.toLowerCase() === orderId.toLowerCase()) ||
            (o.order_id && o.order_id.toLowerCase().includes(orderId.toLowerCase()))
        );
        if (order) {
            orderId = order.order_id;
        }
    }

    // If no identifier provided, pick the latest pending order
    if (!order) {
        const pendingOrders = Object.values(orders).filter(o => o.status === 'PENDING');
        if (pendingOrders.length === 0) {
            await sendTelegram('sendMessage', {
                chat_id: replyChatId,
                text: '⚠️ <b>No pending orders found to approve.</b>\nለማጽደቅ ምንም በመጠባበቅ ላይ ያለ ትዕዛዝ የለም።',
                parse_mode: 'HTML'
            });
            return;
        }

        if (!orderId) {
            order = pendingOrders[pendingOrders.length - 1];
            orderId = order.order_id;
        } else {
            await sendTelegram('sendMessage', {
                chat_id: replyChatId,
                text: `❌ <b>Order not found matching:</b> <code>${identifier}</code>\n\nUse <code>/pending</code> to list pending orders.`,
                parse_mode: 'HTML'
            });
            return;
        }
    }

    if (order.status === 'APPROVED') {
        await sendTelegram('sendMessage', {
            chat_id: replyChatId,
            text: `⚠️ Order <b>${orderId}</b> was already approved!\n🔑 <b>Existing License:</b> <code>${order.license_key}</code>`,
            parse_mode: 'HTML'
        });
        return;
    }

    // Generate License Key
    const licenseKey = generateLicenseKey();
    order.status = 'APPROVED';
    order.license_key = licenseKey;
    order.approved_at = new Date().toISOString();
    order.approved_by = adminId;
    orders[orderId] = order;
    saveOrders(orders);

    // Save License Record
    const licenses = loadLicenses();
    licenses[licenseKey] = {
        key: licenseKey,
        order_id: orderId,
        user_id: order.user_id,
        email: order.email,
        status: 'available',
        created_at: new Date().toISOString()
    };
    saveLicenses(licenses);

    let inviterRewarded = false;
    let inviterId = null;

    // Update User Profile & Award Referral Points ONLY on Approval
    if (order.user_id && order.user_id !== 'WEBSITE') {
        const users = loadUsers();
        if (!users[order.user_id]) users[order.user_id] = {};
        users[order.user_id].license_key = licenseKey;
        users[order.user_id].has_purchased = true;

        // Referral Commission (150 ETB commission per student) - STRICTLY only on approval and once
        if (users[order.user_id].invited_by && !order.referral_awarded) {
            inviterId = users[order.user_id].invited_by;
            if (users[inviterId]) {
                const commission = 150;
                users[inviterId].points = (users[inviterId].points || 0) + commission;
                order.referral_awarded = true;
                orders[orderId] = order;
                saveOrders(orders);
                saveUsers(users);
                syncToGoogle('sync_user', { user_id: inviterId, ...users[inviterId] });
                inviterRewarded = true;

                // Send congratulatory notification to the inviter
                await sendTelegram('sendMessage', {
                    chat_id: inviterId,
                    text: `🎉 <b>Congratulations! Referral Commission Earned!</b>\n` +
                        `🎉 <b>እንኳን ደስ አለዎት! የሪፈራል ኮሚሽን ገቢ ተደርጓል!</b>\n\n` +
                        `A student you referred (<b>${order.name}</b>) has enrolled and their payment has been approved!\n` +
                        `የጋበዙት ተማሪ (<b>${order.name}</b>) ክፍያው ተረጋግጦ ላይሰንስ ተልኮለታል።\n\n` +
                        `💰 <b>Commission Added:</b> +${commission} ETB\n` +
                        `💵 <b>Total Referral Balance:</b> ${users[inviterId].points} ETB\n\n` +
                        `Tap <b>"📥 Withdraw Commission"</b> to withdraw via Telebirr anytime.`,
                    parse_mode: 'HTML'
                });
            }
        } else {
            saveUsers(users);
        }

        // 🚀 Send License Key & Instructions to Student (Bilingual)
        const studentDeliveryMsg = `🎉 <b>Congratulations! Your Payment is Approved!</b>\n` +
            `🎉 <b>እንኳን ደስ አለዎት! ክፍያዎ ጸድቋል!</b>\n\n` +
            `Your official License Key for the <b>ICE Trading Psychology (35-Day Mastery Program)</b> is ready:\n\n` +
            `🔑 <b>Your License Key / የእርስዎ ላይሰንስ ኪ፦</b>\n` +
            `<code>${licenseKey}</code>\n\n` +
            `────────────────────\n` +
            `📚 <b>How to start your training (አጠቃቀም)፦</b>\n` +
            `1. Open the platform: <a href="${WEBSITE_URL}">${WEBSITE_URL}</a>\n` +
            `2. Click <b>Register</b> and enter your email (<code>${order.email}</code>) & password\n` +
            `3. Paste your License Key <code>${licenseKey}</code> when prompted\n` +
            `4. Complete the DISC personality assessment and begin Day 1!\n\n` +
            `Welcome aboard! 🚀\n<b>ICE Trading Academy</b>`;

        await sendTelegram('sendMessage', {
            chat_id: order.user_id,
            text: studentDeliveryMsg,
            parse_mode: 'HTML'
        });
    }

    // Sync to Google Sheets
    syncToGoogle('order_approved', order);

    // Update Admin UI
    let adminConfirmation = `✅ <b>Order ${orderId} Approved Successfully!</b>\n\n` +
        `👤 <b>Student:</b> ${order.name}\n` +
        `📧 <b>Email:</b> <code>${order.email}</code>\n` +
        `🆔 <b>User ID:</b> <code>${order.user_id}</code>\n` +
        `🔑 <b>License Key Generated:</b> <code>${licenseKey}</code>\n`;

    if (inviterRewarded && inviterId) {
        adminConfirmation += `👥 <b>Referral Inviter:</b> <code>${inviterId}</code> (+150 ETB credited & notified)\n`;
    }

    adminConfirmation += `\n<i>Student has received the License Key and website registration instructions on Telegram!</i>`;

    await sendTelegram('sendMessage', {
        chat_id: replyChatId,
        text: adminConfirmation,
        parse_mode: 'HTML'
    });
}

// 2. Process Order Rejection
async function processOrderRejection(identifier, adminId, replyChatId) {
    const orders = loadOrders();
    let orderId = identifier ? identifier.trim() : null;
    let order = null;

    if (orderId && orders[orderId]) {
        order = orders[orderId];
    } else if (orderId) {
        const allOrders = Object.values(orders);
        order = allOrders.find(o => 
            (o.user_id && o.user_id.toString() === orderId) ||
            (o.order_id && o.order_id.toLowerCase().includes(orderId.toLowerCase()))
        );
        if (order) orderId = order.order_id;
    }

    if (!order) {
        const pendingOrders = Object.values(orders).filter(o => o.status === 'PENDING');
        if (!orderId && pendingOrders.length > 0) {
            order = pendingOrders[pendingOrders.length - 1];
            orderId = order.order_id;
        } else {
            await sendTelegram('sendMessage', {
                chat_id: replyChatId,
                text: `❌ Order not found to reject: <code>${identifier || ''}</code>`,
                parse_mode: 'HTML'
            });
            return;
        }
    }

    order.status = 'REJECTED';
    order.rejected_at = new Date().toISOString();
    order.rejected_by = adminId;
    orders[orderId] = order;
    saveOrders(orders);

    if (order.user_id && order.user_id !== 'WEBSITE') {
        await sendTelegram('sendMessage', {
            chat_id: order.user_id,
            text: `❌ <b>Payment Verification Notice / የክፍያ ማረጋገጫ ማስታወቂያ</b>\n\n` +
                `We were unable to verify your transaction reference (TxRef: <code>${order.tx_ref}</code>).\n` +
                `Please verify your payment details and re-submit via the bot or contact our support: @ic_ethiopia`,
            parse_mode: 'HTML'
        });
    }

    await sendTelegram('sendMessage', {
        chat_id: replyChatId,
        text: `❌ <b>Order ${orderId} has been rejected.</b>`,
        parse_mode: 'HTML'
    });
}

// 3. List Pending Orders
async function listPendingOrders(replyChatId) {
    const orders = loadOrders();
    const pendingOrders = Object.values(orders).filter(o => o.status === 'PENDING');

    if (pendingOrders.length === 0) {
        await sendTelegram('sendMessage', {
            chat_id: replyChatId,
            text: `✅ <b>All caught up!</b> No pending orders waiting for verification.\nበመጠባበቅ ላይ ያለ ምንም ትዕዛዝ የለም።`,
            parse_mode: 'HTML'
        });
        return;
    }

    let msg = `📋 <b>Pending Verification Orders (${pendingOrders.length})</b>\n\n`;

    pendingOrders.forEach((o, idx) => {
        msg += `<b>${idx + 1}. Order:</b> <code>${o.order_id}</code>\n` +
            `👤 <b>Name:</b> ${o.name} (@${(o.telegram_username || '').replace('@', '') || 'N/A'})\n` +
            `💰 <b>Amount:</b> ${o.price} (${o.payment_method})\n` +
            `🧾 <b>TxRef:</b> <code>${o.tx_ref}</code>\n` +
            `👉 <b>Quick Approve:</b> <code>/approve ${o.order_id}</code>\n\n`;
    });

    await sendTelegram('sendMessage', {
        chat_id: replyChatId,
        text: msg,
        parse_mode: 'HTML'
    });
}

// --- Callback Query Handler (Admin Approval & Actions) ---
async function handleCallbackQuery(cq) {
    const data = cq.data || '';
    const fromId = cq.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(fromId);
    const message = cq.message;
    const chatId = message ? message.chat.id : fromId;

    await sendTelegram('answerCallbackQuery', { callback_query_id: cq.id });

    if (!isAdmin) {
        await sendTelegram('sendMessage', { chat_id: fromId, text: '❌ Unauthorized. Admin access required.' });
        return;
    }

    // 1. Approve Order
    if (data.startsWith('approve_')) {
        const orderId = data.replace('approve_', '');
        await processOrderApproval(orderId, fromId, chatId);
    }

    // 2. Reject Order
    else if (data.startsWith('reject_')) {
        const orderId = data.replace('reject_', '');
        await processOrderRejection(orderId, fromId, chatId);
    }

    // 3. Reply Prompt for Admin
    else if (data.startsWith('replyprompt_')) {
        const targetUserId = data.replace('replyprompt_', '');
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `💬 <b>To send a message to this student, use:</b>\n\n<code>/reply ${targetUserId} Hello, </code>`,
            parse_mode: 'HTML'
        });
    }
}

// --- Message Handler ---
async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const userId = msg.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    const users = loadUsers();

    // Ensure User Record Exists
    if (!users[userId]) {
        users[userId] = {
            name: msg.from.first_name || 'Trader',
            username: msg.from.username || 'N/A',
            points: 0,
            joined_at: new Date().toISOString()
        };

        if (text.startsWith('/start ref_')) {
            const inviterId = text.split('_')[1];
            if (inviterId && inviterId !== userId && users[inviterId]) {
                users[userId].invited_by = inviterId;
                await sendTelegram('sendMessage', {
                    chat_id: inviterId,
                    text: `🔔 <b>New Referral / አዲስ ግብዣ!</b>\n\n<b>${msg.from.first_name}</b> started the bot using your link. When they enroll, you will earn <b>150 ETB commission</b>!`,
                    parse_mode: 'HTML'
                });
            }
        }
        saveUsers(users);
        syncToGoogle('sync_user', { user_id: userId, ...users[userId] });
    }

    // -------------------------------------------------------------
    // 💵 TELEBIRR WITHDRAWAL STEP-BY-STEP FLOW
    // -------------------------------------------------------------
    if (users[userId] && users[userId].withdraw_step) {
        const step = users[userId].withdraw_step;

        if (step === 'awaiting_telebirr_phone') {
            users[userId].temp_telebirr = text.trim();
            users[userId].withdraw_step = 'awaiting_payout_name';
            saveUsers(users);

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `👤 <b>Step 2/2: Account Name / ሙሉ ስም</b>\n\nPlease enter the <b>Full Name</b> registered on your Telebirr account:\nበቴሌብር አካውንትዎ ላይ ያለውን ሙሉ ስም ያስገቡ፦`,
                parse_mode: 'HTML'
            });
            return;
        }

        else if (step === 'awaiting_payout_name') {
            const currentPoints = users[userId].points || 0;
            const telebirrPhone = users[userId].temp_telebirr;
            const fullName = text.trim();

            for (const adminId of ADMIN_IDS) {
                await sendTelegram('sendMessage', {
                    chat_id: adminId,
                    text: `💰 <b>New Telebirr Commission Payout Request!</b>\n\n` +
                        `👤 <b>User:</b> ${msg.from.first_name} (@${msg.from.username || 'N/A'})\n` +
                        `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
                        `💵 <b>Amount:</b> <b>${currentPoints} ETB</b>\n` +
                        `📱 <b>Telebirr Phone:</b> <code>${telebirrPhone}</code>\n` +
                        `👤 <b>Account Name:</b> ${fullName}\n\n` +
                        `────────────────────\n` +
                        `Send confirmation to user after transfer:\n` +
                        `<code>/reply ${userId} Hello ${msg.from.first_name}, your commission of ${currentPoints} ETB has been sent via Telebirr (${telebirrPhone}). Thank you!</code>`,
                    parse_mode: 'HTML'
                });
            }

            syncToGoogle('payout_request', {
                user_id: userId,
                name: msg.from.first_name,
                amount: currentPoints,
                phone: telebirrPhone,
                account_name: fullName
            });

            users[userId].points = 0;
            delete users[userId].withdraw_step;
            delete users[userId].temp_telebirr;
            saveUsers(users);

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Withdrawal Request Submitted / የክፍያ ጥያቄዎ ተመዝግቧል!</b>\n\nYour Telebirr details have been received. The transfer will be processed shortly to ${telebirrPhone}. Thank you!`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
            return;
        }
    }

    // -------------------------------------------------------------
    // 🔘 KEYBOARD COMMANDS (ENGLISH & BILINGUAL)
    // -------------------------------------------------------------

    // /start command
    if (text.startsWith('/start')) {
        const welcomeMsg = `👋 <b>Welcome to ICE Trading Psychology Academy!</b>\n` +
            `👋 <b>እንኳን ወደ ICE Trading Psychology Academy በሰላም መጡ!</b>\n\n` +
            `🧠 <b>ICE CORE — 35-Day Trading Psychology Mastery Program</b>\n` +
            `የ 35 ቀናት የትሬዲንግ ስነ-ልቦና እና ዲሲፕሊን ማስተሪ ስልጠና\n\n` +
            `Master your emotions, eliminate trading anxiety, develop strict risk management discipline, and become a consistently profitable trader.\n\n` +
            `💎 <b>Program Features / ምን ያካትታል?</b>\n` +
            `• 35 Daily High-Impact Video Lectures (Drip-Feed)\n` +
            `• DISC Personality Assessment & Tailored Challenges\n` +
            `• Daily Trading Psychology Journal & Mentor Reviews\n` +
            `• Day 22 Research Paper Assignment\n\n` +
            `💵 <b>Price / ዋጋ፦</b> <b>5,999 ETB</b> (or <b>$45 USDT</b>)\n` +
            `🎁 <b>Partner Discount፦</b> <i>Get 30% OFF (<b>4,199 ETB</b>) if you trade with our partner broker link!</i>\n\n` +
            `👇 <b>Tap below to open the registration form and verify your payment:</b>`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: welcomeMsg,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 👥 Referral Link
    if (text === '👥 Referral Link' || text === '👥 የእኔ ሪፈራል ሊንክ') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
        const refMsg = `👥 <b>Your Unique Referral Link / የእርስዎ የሪፈራል ሊንክ፦</b>\n\n` +
            `<code>${refLink}</code>\n\n` +
            `💡 <b>How it works / አሰራር፦</b>\n` +
            `Share this link with fellow traders. When they enroll in the ICE program, you earn <b>150 ETB commission</b> instantly added to your balance!\n` +
            `ይህንን ሊንክ ለትሬደር ጓደኞችዎ ያጋሩ። በእርስዎ ሊንክ ሲመዘገቡ <b>150 ብር ኮሚሽን</b> ያገኛሉ።\n\n` +
            `Withdraw anytime via Telebirr.`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: refMsg,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📤 Share with Friends / ለጓደኞችህ አጋራ", url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("Join the 35-Day ICE Trading Psychology Program. Master your discipline and mindset!")}` }]
                ]
            }
        });
        return;
    }

    // 💰 My Balance
    if (text === '💰 My Balance' || text === '💰 የእኔ ባላንስ') {
        const balance = users[userId]?.points || 0;
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `💰 <b>Your Referral Balance / የእርስዎ ባላንስ፦</b> <b>${balance} ETB</b>\n\n` +
                `Minimum withdrawal threshold is <b>150 ETB</b>.\n\n` +
                `Tap <b>"📥 Withdraw Commission"</b> to withdraw via Telebirr.`,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 🔑 My License Key
    if (text === '🔑 My License Key' || text === '🔑 የእኔ ላይሰንስ ኪ') {
        const licenseKey = users[userId]?.license_key;
        if (licenseKey) {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `🔑 <b>Your Active License Key / የነቃው License Key፦</b>\n\n<code>${licenseKey}</code>\n\n` +
                    `Use this key on <a href="${WEBSITE_URL}">${WEBSITE_URL}</a> to access your 35-Day course.`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
        } else {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>No active License Key found.</b>\n\nTo enroll and get your key, tap <b>"💎 Enroll / Verify Payment"</b> below.`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
        }
        return;
    }

    // 📥 Withdraw Commission
    if (text === '📥 Withdraw Commission' || text === '📥 ብር ማውጫ (Withdraw)') {
        const currentPoints = users[userId]?.points || 0;
        if (currentPoints < 150) {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>Minimum withdrawal amount is 150 ETB.</b>\n\nYour current balance: <b>${currentPoints} ETB</b>. Share your referral link to earn commissions!`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
            return;
        }

        users[userId].withdraw_step = 'awaiting_telebirr_phone';
        saveUsers(users);

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `📥 <b>Telebirr Commission Withdrawal / የቴሌብር ብር ማውጫ</b>\n\n` +
                `Amount to withdraw: <b>${currentPoints} ETB</b>\n\n` +
                `📱 <b>Step 1/2:</b> Enter your <b>Telebirr phone number</b> (e.g. <code>0912345678</code>):\nየቴሌብር ስልክ ቁጥርዎን ያስገቡ፦`,
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [[{ text: '❌ Cancel' }]],
                resize_keyboard: true
            }
        });
        return;
    }

    // Cancel
    if (text === '❌ Cancel' || text === '❌ ሰርዝ (Cancel)') {
        if (users[userId]) {
            delete users[userId].withdraw_step;
            delete users[userId].temp_telebirr;
            saveUsers(users);
        }
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `Cancelled. Returned to main menu.`,
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 🌐 Open Website
    if (text === '🌐 Open Website' || text === '🌐 ዌብሳይቱን ክፈት (ICE Core)') {
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `🌐 <b>ICE Core Platform / ኦፊሴላዊ ድረ-ገጽ፦</b>\n\n<a href="${WEBSITE_URL}">${WEBSITE_URL}</a>\n\nLogin with your registered email and License Key.`,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 📞 Support
    if (text === '📞 Support' || text === '📞 ድጋፍ ሰጪ (Support)') {
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `📞 <b>ICE Academy Support Team:</b>\n\nDirect contact on Telegram:\n👉 @ic_ethiopia`,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // -------------------------------------------------------------
    // 👑 ADMIN COMMANDS
    // -------------------------------------------------------------
    if (isAdmin) {
        const lowerText = text.toLowerCase().trim();

        // 1. /approve or /approved <orderId / userId / email> or just /approve
        if (lowerText.startsWith('/approve') || lowerText.startsWith('/approved')) {
            const parts = text.trim().split(/\s+/);
            const identifier = parts.length > 1 ? parts.slice(1).join(' ') : null;
            await processOrderApproval(identifier, userId, chatId);
            return;
        }

        // 2. /reject or /rejected <orderId / userId>
        if (lowerText.startsWith('/reject') || lowerText.startsWith('/rejected')) {
            const parts = text.trim().split(/\s+/);
            const identifier = parts.length > 1 ? parts.slice(1).join(' ') : null;
            await processOrderRejection(identifier, userId, chatId);
            return;
        }

        // 3. /pending or /orders
        if (lowerText === '/pending' || lowerText === '/orders') {
            await listPendingOrders(chatId);
            return;
        }

        // 4. /admin or /adminhelp or /help
        if (lowerText === '/admin' || lowerText === '/adminhelp' || lowerText === '/help') {
            const helpMsg = `👑 <b>ICE Bot Admin Command Center / የአድሚን ትዕዛዞች</b>\n\n` +
                `✅ <b>/approve [order_id / user_id / email]</b>\n` +
                `└ <i>Approve order, generate license key, award inviter +150 ETB commission, and send credentials to student.</i>\n` +
                `💡 <i>Tip: Typing <code>/approve</code> or <code>/approved</code> alone automatically approves the latest pending order!</i>\n\n` +
                `❌ <b>/reject [order_id / user_id]</b>\n` +
                `└ <i>Reject payment verification and notify student.</i>\n\n` +
                `📋 <b>/pending</b> or <b>/orders</b>\n` +
                `└ <i>List all orders currently waiting for verification.</i>\n\n` +
                `📊 <b>/stats</b>\n` +
                `└ <i>View total user count, total orders, and approval metrics.</i>\n\n` +
                `🔑 <b>/license &lt;email&gt;</b>\n` +
                `└ <i>Manually generate a standalone 35-day license key.</i>\n\n` +
                `💬 <b>/reply &lt;user_id&gt; &lt;message&gt;</b>\n` +
                `└ <i>Send a direct message to any student on Telegram.</i>\n\n` +
                `📢 <b>/broadcast &lt;message&gt;</b>\n` +
                `└ <i>Broadcast an announcement to all bot users.</i>`;

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: helpMsg,
                parse_mode: 'HTML'
            });
            return;
        }

        // 5. /stats
        if (text === '/stats') {
            const allUsers = Object.keys(users).length;
            const allOrders = Object.values(loadOrders());
            const approvedOrders = allOrders.filter(o => o.status === 'APPROVED').length;
            const pendingOrders = allOrders.filter(o => o.status === 'PENDING').length;

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `📊 <b>ICE Bot Statistics</b>\n\n` +
                    `👥 <b>Total Registered Users:</b> ${allUsers}\n` +
                    `🛍️ <b>Total Orders:</b> ${allOrders.length}\n` +
                    `✅ <b>Approved Orders:</b> ${approvedOrders}\n` +
                    `⏳ <b>Pending Verification:</b> ${pendingOrders}\n`,
                parse_mode: 'HTML'
            });
            return;
        }

        // 6. /license
        if (text.startsWith('/license')) {
            const parts = text.split(' ');
            const targetEmail = parts[1] ? parts[1].trim() : 'student@ice.com';
            const key = generateLicenseKey();

            const licenses = loadLicenses();
            licenses[key] = {
                key,
                email: targetEmail,
                status: 'available',
                created_at: new Date().toISOString()
            };
            saveLicenses(licenses);

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>License Key Generated!</b>\n\n🔑 <b>Key:</b> <code>${key}</code>\n📧 <b>Assigned Email:</b> ${targetEmail}`,
                parse_mode: 'HTML'
            });
            return;
        }

        // 7. /reply
        if (text.startsWith('/reply')) {
            const parts = text.split(' ');
            const targetId = parts[1];
            const replyMsg = parts.slice(2).join(' ');

            if (!targetId || !replyMsg) {
                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ <b>Usage:</b> <code>/reply &lt;user_id&gt; &lt;message&gt;</code>`,
                    parse_mode: 'HTML'
                });
                return;
            }

            await sendTelegram('sendMessage', {
                chat_id: targetId,
                text: `📩 <b>Message from ICE Academy Admin:</b>\n\n${replyMsg}`,
                parse_mode: 'HTML'
            });

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ Message sent to user <code>${targetId}</code>!`,
                parse_mode: 'HTML'
            });
            return;
        }

        // 8. /broadcast
        if (text.startsWith('/broadcast')) {
            const broadcastMsg = text.replace('/broadcast', '').trim();
            if (!broadcastMsg) {
                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ <b>Usage:</b> <code>/broadcast &lt;message text&gt;</code>`,
                    parse_mode: 'HTML'
                });
                return;
            }

            const allUserIds = Object.keys(users);
            let count = 0;
            for (const uid of allUserIds) {
                await sendTelegram('sendMessage', {
                    chat_id: uid,
                    text: `📢 <b>ICE Academy Announcement</b>\n\n${broadcastMsg}`,
                    parse_mode: 'HTML'
                });
                count++;
            }

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ Broadcast sent to <b>${count}</b> users!`,
                parse_mode: 'HTML'
            });
            return;
        }
    }
}

// -------------------------------------------------------------
// 🔄 AUTOMATIC TELEGRAM POLLING (FALLBACK FOR LOCAL TESTING)
// -------------------------------------------------------------
let lastUpdateId = 0;
async function startTelegramPolling() {
    if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') return;
    console.log('🤖 Telegram Long-Polling started...');

    setInterval(async () => {
        try {
            const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
                params: { offset: lastUpdateId + 1, timeout: 10 }
            });

            if (res.data && res.data.ok && res.data.result.length > 0) {
                for (const update of res.data.result) {
                    lastUpdateId = update.update_id;
                    if (update.callback_query) {
                        await handleCallbackQuery(update.callback_query);
                    } else if (update.message) {
                        await handleMessage(update.message);
                    }
                }
            }
        } catch (e) {
            // Ignore polling network blips
        }
    }, 2000);
}

// -------------------------------------------------------------
// 🚀 SERVER STARTUP
// -------------------------------------------------------------
app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`🚀 ICE Register Bot Server running on port ${PORT}`);
    console.log(`🌐 Web URL: ${WEB_URL}`);
    console.log(`🌐 Website URL: ${WEBSITE_URL}`);
    console.log(`🤖 Bot Username: @${BOT_USERNAME}`);
    console.log(`👤 Admin ID: ${ADMIN_IDS.join(', ')}`);
    console.log(`===============================================`);

    await syncFromGoogleSheets();
    startTelegramPolling();
});
