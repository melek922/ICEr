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
const WEB_URL = process.env.WEB_URL || 'https://icer.onrender.com';
const WEBSITE_URL = 'https://ice-psychology.pro.et';
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL || '';
const BOT_USERNAME = process.env.BOT_USERNAME || 'ice_registration_bot';
const TELEBIRR_NUMBER = process.env.TELEBIRR_NUMBER || '0941550511';
const TELEBIRR_NAME = process.env.TELEBIRR_NAME || 'Nathanael';
const USDT_ADDRESS = process.env.USDT_BEP20_ADDRESS || '0x23930c96268269c169d3825e47b0538cfb77d2ff';

// ☁️ Cloudinary Configuration (Server-Side Protected)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'rbkihpxg';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'ice_preset';

// 🔄 Admin Reply Tracker (Maps admin notification message_id -> target user_id)
const adminMessageMap = {};

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function uploadToCloudinary(fileInput) {
    if (!fileInput) return '';
    if (!fileInput.startsWith('data:image') && !fileInput.startsWith('http://') && !fileInput.startsWith('https://')) {
        return fileInput;
    }
    try {
        console.log('☁️ Uploading receipt to Cloudinary server-side...');
        const response = await axios.post(
            `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
            {
                file: fileInput,
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
    return typeof fileInput === 'string' && fileInput.startsWith('http') ? fileInput : '';
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

// 🌐 Sync & Get Valid License Key Directly from Website Database (ice-psychology.pro.et)
async function getWebsiteLicenseKey() {
    try {
        // 1. Try to fetch an available unassigned key directly from website pool
        const listRes = await axios.get(`${WEBSITE_URL}/api/license`, { timeout: 4000 });
        if (listRes.data && listRes.data.keys && Array.isArray(listRes.data.keys)) {
            const available = listRes.data.keys.find(k => k.status === 'available');
            if (available && available.key) {
                console.log('✅ Acquired available key from website database pool:', available.key);
                return available.key;
            }
        }
    } catch (e) {
        console.warn('⚠️ Website license list API:', e.message);
    }

    try {
        // 2. Try to generate a new key on website database
        const genRes = await axios.post(`${WEBSITE_URL}/api/license`, { count: 1 }, { timeout: 4000 });
        if (genRes.data && genRes.data.keys && genRes.data.keys.length > 0) {
            const k = genRes.data.keys[0];
            const generated = typeof k === 'string' ? k : (k.key || generateLicenseKey());
            console.log('✅ Generated new key on website database:', generated);
            return generated;
        }
    } catch (e) {
        console.warn('⚠️ Website license generate API:', e.message);
    }

    // 3. Fallback format
    return generateLicenseKey();
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

// 🌐 Website Integration Helper: Sync Order to Website Dashboard (ice-psychology.pro.et)
async function syncOrderToWebsite(orderData) {
    if (!WEBSITE_URL) return;
    try {
        console.log(`🌐 Syncing order ${orderData.order_id} to website (${WEBSITE_URL})...`);
        const payload = {
            orderId: orderData.order_id,
            userId: orderData.user_id ? orderData.user_id.toString() : '',
            telegramId: orderData.user_id ? orderData.user_id.toString() : '',
            name: orderData.name || 'Student',
            email: orderData.email || 'N/A',
            phone: orderData.phone || 'N/A',
            telegramUsername: orderData.telegram_username || 'N/A',
            package: orderData.package_type || 'ICE 35-Day Mastery',
            tier: orderData.package_type || 'ICE 35-Day Mastery',
            price: orderData.price || '5,999 ETB',
            amount: orderData.price || '5,999 ETB',
            method: orderData.payment_method || 'TELEGRAM_MANUAL',
            paymentMethod: orderData.payment_method || 'TELEGRAM_MANUAL',
            txRef: orderData.tx_ref || 'N/A',
            receiptUrl: orderData.receipt_url || '',
            status: orderData.status || 'PENDING',
            studentId: orderData.student_id || 'N/A',
            brokerWalletId: orderData.broker_wallet_id || 'N/A',
            createdAt: orderData.created_at || new Date().toISOString()
        };

        const res = await axios.post(`${WEBSITE_URL}/api/bot/register`, payload, {
            timeout: 7000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (res.data) {
            console.log(`✅ Order ${orderData.order_id} synced to website dashboard successfully!`);
        }
    } catch (err) {
        console.warn(`⚠️ Website order sync notice (${orderData.order_id}):`, err.response ? err.response.data : err.message);
    }
}

// 🌐 Website Integration Helper: Notify Website of Approved Order
async function notifyWebsiteApproval(order, licenseKey, adminId = 'ADMIN') {
    if (!WEBSITE_URL) return;
    try {
        console.log(`🌐 Notifying website of approval for order ${order.order_id}...`);
        const payload = {
            action: 'approve',
            status: 'SUCCESS',
            orderId: order.order_id,
            email: order.email,
            userId: order.user_id ? order.user_id.toString() : '',
            telegramId: order.user_id ? order.user_id.toString() : '',
            licenseKey: licenseKey,
            txRef: order.tx_ref,
            package: order.package_type,
            approvedAt: order.approved_at || new Date().toISOString(),
            approvedBy: adminId
        };

        const res = await axios.post(`${WEBSITE_URL}/api/bot/register`, payload, {
            timeout: 7000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (res.data) {
            console.log(`✅ Website approval notified successfully for order ${order.order_id}`);
        }
    } catch (err) {
        console.warn(`⚠️ Website approval notify notice (${order.order_id}):`, err.response ? err.response.data : err.message);
    }
}

// 🌐 Website Integration Helper: Notify Website of Rejected Order
async function notifyWebsiteRejection(order, adminId = 'ADMIN') {
    if (!WEBSITE_URL) return;
    try {
        console.log(`🌐 Notifying website of rejection for order ${order.order_id}...`);
        const payload = {
            action: 'reject',
            status: 'REJECTED',
            orderId: order.order_id,
            email: order.email,
            userId: order.user_id ? order.user_id.toString() : '',
            telegramId: order.user_id ? order.user_id.toString() : '',
            txRef: order.tx_ref,
            rejectedAt: order.rejected_at || new Date().toISOString(),
            rejectedBy: adminId
        };

        const res = await axios.post(`${WEBSITE_URL}/api/bot/register`, payload, {
            timeout: 7000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (res.data) {
            console.log(`✅ Website rejection notified successfully for order ${order.order_id}`);
        }
    } catch (err) {
        console.warn(`⚠️ Website rejection notify notice (${order.order_id}):`, err.response ? err.response.data : err.message);
    }
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
            usdt_bep20: USDT_ADDRESS
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
            student_id,
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
            student_id: student_id || 'N/A',
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

        // Sync to Website Dashboard (ice-psychology.pro.et)
        syncOrderToWebsite(orderData);

        // 🔗 Generate Official Live Verification Link
        const cleanTxRef = (orderData.tx_ref || '').trim();
        let verifyUrl = '';
        let verifyLabel = '';

        if (orderData.payment_method === 'TELEBIRR') {
            verifyUrl = `https://transactioninfo.ethiotelecom.et/receipt/${encodeURIComponent(cleanTxRef)}`;
            verifyLabel = '🔍 Verify Telebirr Receipt (Ethio Telecom Live)';
        } else {
            verifyUrl = `https://bscscan.com/tx/${encodeURIComponent(cleanTxRef)}`;
            verifyLabel = '🔍 Verify USDT (BEP20) on BscScan (BSC Live)';
        }

        // 🔔 Notify Admins on Telegram with Instant Inline Action Buttons
        let adminMsg = `🚨 <b>New Payment Verification Request!</b>\n\n` +
            `📦 <b>Package:</b> 💎 <b>${orderData.package_type}</b>\n` +
            `💰 <b>Amount:</b> <b>${orderData.price}</b>\n` +
            `💳 <b>Method:</b> ${orderData.payment_method}\n` +
            `🧾 <b>TxRef / Hash:</b> <code>${orderData.tx_ref}</code>\n` +
            `🌐 <b>Official Receipt:</b> <a href="${verifyUrl}">Click to View Live Receipt</a>\n\n`;

        if (orderData.student_id && orderData.student_id !== 'N/A') {
            adminMsg += `🎓 <b>Negadras Student ID:</b> <code>${orderData.student_id}</code> (50% Negadras Tier)\n\n`;
        }

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
            `👉 <i>Check the live receipt above, then click Approve to generate and send the License Key automatically.</i>\n\n` +
            `💬 <b>Quick Reply / መልስ ለመስጠት፦</b>\n` +
            `1️⃣ <i>Swipe & Reply directly to this message</i>\n` +
            `2️⃣ <i>Or copy and send:</i>\n` +
            `<code>/reply ${orderData.user_id} Hello ${orderData.name}, </code>`;

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
                if (photoRes && photoRes.data && photoRes.data.result) {
                    adminMessageMap[photoRes.data.result.message_id] = orderData.user_id;
                    sent = true;
                }
            }

            if (!sent) {
                const sentRes = await sendTelegram('sendMessage', {
                    chat_id: adminId,
                    text: adminMsg,
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard
                });
                if (sentRes && sentRes.data && sentRes.data.result) {
                    adminMessageMap[sentRes.data.result.message_id] = orderData.user_id;
                }
            }
        }

        // 📩 Confirmation to Student on Telegram
        if (user_id && user_id !== 'WEBSITE') {
            const customerMsg = `✅ <b>Payment Submitted Successfully! / ክፍያዎ በተሳካ ሁኔታ ተልኳል!</b>\n\n` +
                `🔢 <b>Order ID:</b> <code>${orderId}</code>\n` +
                `📦 <b>Package:</b> ${orderData.package_type}\n` +
                `💰 <b>Amount:</b> ${orderData.price}\n` +
                `🧾 <b>TxRef:</b> <code>${orderData.tx_ref}</code>\n\n` +
                `⏳ <b>EN:</b> ICE Admins are verifying your transaction. Your <b>License Key</b> and website login guide will be sent here on Telegram shortly.\n\n` +
                `⏳ <b>AM:</b> አድሚኖች የላኩትን መረጃ እያረጋገጡ ነው። የ <b>License Key</b> በአጭር ጊዜ ውስጥ በዚሁ ቴሌግራም ይደርስዎታል።\n\n` +
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

// 2. Direct Website Manual Payment & Dashboard Two-Way Sync Webhook
app.post('/api/website-payment', async (req, res) => {
    try {
        const {
            email,
            txRef,
            tx_ref,
            method,
            paymentMethod,
            amount,
            price,
            orderId,
            order_id,
            status,
            action,
            licenseKey,
            license_key,
            userId,
            user_id,
            name
        } = req.body;

        const effectiveOrderId = orderId || order_id;
        const effectiveTxRef = txRef || tx_ref || 'N/A';
        const effectiveStatus = (status || action || '').toUpperCase();

        // Case A: Website Admin approved order on website dashboard
        if (effectiveStatus === 'APPROVED' || effectiveStatus === 'SUCCESS' || action === 'approve') {
            const targetIdentifier = effectiveOrderId || email || effectiveTxRef;
            console.log(`🌐 Received approval signal from website dashboard for: ${targetIdentifier}`);
            if (targetIdentifier) {
                await processOrderApproval(targetIdentifier, 'WEBSITE_DASHBOARD', null);
            }
            return res.status(200).json({ success: true, message: 'Order approved and synced' });
        }

        // Case B: Website Admin rejected order on website dashboard
        if (effectiveStatus === 'REJECTED' || action === 'reject') {
            const targetIdentifier = effectiveOrderId || email || effectiveTxRef;
            console.log(`🌐 Received rejection signal from website dashboard for: ${targetIdentifier}`);
            if (targetIdentifier) {
                await processOrderRejection(targetIdentifier, 'WEBSITE_DASHBOARD', null);
            }
            return res.status(200).json({ success: true, message: 'Order rejected and synced' });
        }

        // Case C: New payment submission pending verification on website
        const genOrderId = effectiveOrderId || `WEB-${Date.now()}`;
        const newOrderData = {
            order_id: genOrderId,
            user_id: user_id || userId || 'WEBSITE',
            name: name || email || 'Website Student',
            phone: 'Via Website',
            email: email || 'N/A',
            telegram_username: 'N/A',
            broker_wallet_id: 'N/A',
            package_type: 'ICE 35-Day Mastery (Website)',
            price: amount || price || '5,999 ETB',
            payment_method: method || paymentMethod || 'TELEBIRR / WEBSITE',
            receipt_url: '',
            tx_ref: effectiveTxRef,
            status: 'PENDING',
            created_at: new Date().toISOString()
        };

        const orders = loadOrders();
        orders[genOrderId] = newOrderData;
        saveOrders(orders);
        syncToGoogle('new_order', newOrderData);

        const adminMsg = `🌐 <b>New Payment on Website (ice-psychology.pro.et)!</b>\n\n` +
            `📧 <b>Email:</b> <code>${email}</code>\n` +
            `💳 <b>Method:</b> ${method || paymentMethod || 'Telebirr/Crypto'}\n` +
            `🧾 <b>TxRef / Hash:</b> <code>${effectiveTxRef}</code>\n` +
            `💰 <b>Amount:</b> ${amount || price || '5,999 ETB'}\n` +
            `🔢 <b>Order ID:</b> <code>${genOrderId}</code>\n` +
            `⏰ <b>Date:</b> ${new Date().toLocaleString()}\n\n` +
            `────────────────────\n` +
            `👉 <i>Approve directly here or on the website dashboard!</i>`;

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Approve & Send License Key', callback_data: `approve_${genOrderId}` },
                    { text: '❌ Reject', callback_data: `reject_${genOrderId}` }
                ]
            ]
        };

        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: adminMsg,
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard
            });
        }

        res.status(200).json({ success: true, order_id: genOrderId });
    } catch (e) {
        console.error('Website Payment Webhook Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Two-Way Order Status & Action Webhook
app.post('/api/order-status', async (req, res) => {
    try {
        const { orderId, order_id, email, txRef, tx_ref, status, action } = req.body;
        const targetIdentifier = orderId || order_id || email || txRef || tx_ref;
        const effectiveStatus = (status || action || '').toUpperCase();

        if (effectiveStatus === 'APPROVED' || effectiveStatus === 'SUCCESS' || action === 'approve') {
            if (targetIdentifier) {
                await processOrderApproval(targetIdentifier, 'WEBSITE_DASHBOARD', null);
            }
            return res.json({ success: true, status: 'APPROVED' });
        } else if (effectiveStatus === 'REJECTED' || action === 'reject') {
            if (targetIdentifier) {
                await processOrderRejection(targetIdentifier, 'WEBSITE_DASHBOARD', null);
            }
            return res.json({ success: true, status: 'REJECTED' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('/api/order-status error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/bot/order-action', async (req, res) => {
    try {
        const { orderId, order_id, email, txRef, tx_ref, action, status } = req.body;
        const targetIdentifier = orderId || order_id || email || txRef || tx_ref;
        const act = (action || status || '').toLowerCase();

        if (act === 'approve' || act === 'approved' || act === 'success') {
            if (targetIdentifier) {
                await processOrderApproval(targetIdentifier, 'WEBSITE_DASHBOARD', null);
            }
            return res.json({ success: true, action: 'approve' });
        } else if (act === 'reject' || act === 'rejected') {
            if (targetIdentifier) {
                await processOrderRejection(targetIdentifier, 'WEBSITE_DASHBOARD', null);
            }
            return res.json({ success: true, action: 'reject' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('/api/bot/order-action error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. API to Query Orders and System Status
app.get('/api/orders', (req, res) => {
    res.json({ success: true, orders: loadOrders() });
});

app.get('/api/users', (req, res) => {
    res.json({ success: true, users: loadUsers() });
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

    // Generate/Fetch Valid License Key Synced with Website Database
    const licenseKey = await getWebsiteLicenseKey();
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
        const emailDisplay = (order.email && !order.email.toLowerCase().includes('telegram')) ? ` (<code>${order.email}</code>)` : '';
        const studentDeliveryMsg = `🎉 <b>Congratulations! Your Payment is Approved!</b>\n` +
            `🎉 <b>እንኳን ደስ አለዎት! ክፍያዎ ጸድቋል!</b>\n\n` +
            `Your official License Key for the <b>ICE Trading Psychology (35-Day Mastery Program)</b> is ready:\n\n` +
            `🔑 <b>Your License Key / የእርስዎ ላይሰንስ ኪ፦</b>\n` +
            `<code>${licenseKey}</code>\n\n` +
            `────────────────────\n` +
            `📚 <b>How to start your training (አጠቃቀም)፦</b>\n` +
            `1. Open the platform: <a href="${WEBSITE_URL}">${WEBSITE_URL}</a>\n` +
            `2. Click <b>Register</b> and enter your email${emailDisplay} & password\n` +
            `3. Paste your License Key <code>${licenseKey}</code> when prompted\n` +
            `4. Complete the DISC personality assessment and begin Day 1!\n\n` +
            `Welcome aboard! 🚀\n<b>ICE Trading Academy</b>`;

        await sendTelegram('sendMessage', {
            chat_id: order.user_id,
            text: studentDeliveryMsg,
            parse_mode: 'HTML'
        });
    }

    // Sync to Google Sheets & Notify Website Dashboard
    syncToGoogle('order_approved', order);
    await notifyWebsiteApproval(order, licenseKey, adminId);

    // Update Admin UI
    let adminConfirmation = `✅ <b>Order ${orderId} Approved Successfully!</b>\n\n` +
        `👤 <b>Student:</b> ${order.name}\n` +
        `📧 <b>Email:</b> <code>${order.email}</code>\n` +
        `🆔 <b>User ID:</b> <code>${order.user_id}</code>\n` +
        `🔑 <b>License Key Generated:</b> <code>${licenseKey}</code>\n`;

    if (inviterRewarded && inviterId) {
        adminConfirmation += `👥 <b>Referral Inviter:</b> <code>${inviterId}</code> (+150 ETB credited & notified)\n`;
    }

    if (adminId === 'WEBSITE_DASHBOARD') {
        adminConfirmation += `\n🌐 <i>Approved via Website Dashboard (ice-psychology.pro.et)!</i>\n`;
    }

    adminConfirmation += `\n<i>Student has received the License Key and website registration instructions on Telegram!</i>`;

    if (replyChatId) {
        await sendTelegram('sendMessage', {
            chat_id: replyChatId,
            text: adminConfirmation,
            parse_mode: 'HTML'
        });
    } else {
        for (const aId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: aId,
                text: adminConfirmation,
                parse_mode: 'HTML'
            });
        }
    }
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
            (o.email && o.email.toLowerCase() === orderId.toLowerCase()) ||
            (o.tx_ref && o.tx_ref.toLowerCase() === orderId.toLowerCase()) ||
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
            const notFoundMsg = `❌ Order not found to reject: <code>${identifier || ''}</code>`;
            if (replyChatId) {
                await sendTelegram('sendMessage', {
                    chat_id: replyChatId,
                    text: notFoundMsg,
                    parse_mode: 'HTML'
                });
            }
            return;
        }
    }

    order.status = 'REJECTED';
    order.rejected_at = new Date().toISOString();
    order.rejected_by = adminId;
    orders[orderId] = order;
    saveOrders(orders);

    // Sync to Google Sheets & Notify Website Dashboard
    syncToGoogle('order_rejected', order);
    await notifyWebsiteRejection(order, adminId);

    if (order.user_id && order.user_id !== 'WEBSITE') {
        await sendTelegram('sendMessage', {
            chat_id: order.user_id,
            text: `❌ <b>Payment Verification Notice / የክፍያ ማረጋገጫ ማስታወቂያ</b>\n\n` +
                `We were unable to verify your transaction reference (TxRef: <code>${order.tx_ref}</code>).\n` +
                `Please verify your payment details and re-submit via the bot or contact our support: @ic_ethiopia`,
            parse_mode: 'HTML'
        });
    }

    const rejectionAdminMsg = adminId === 'WEBSITE_DASHBOARD'
        ? `❌ <b>Order ${orderId} has been rejected via Website Dashboard (ice-psychology.pro.et).</b>`
        : `❌ <b>Order ${orderId} has been rejected.</b>`;

    if (replyChatId) {
        await sendTelegram('sendMessage', {
            chat_id: replyChatId,
            text: rejectionAdminMsg,
            parse_mode: 'HTML'
        });
    } else {
        for (const aId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: aId,
                text: rejectionAdminMsg,
                parse_mode: 'HTML'
            });
        }
    }
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
            text: `💬 <b>Reply to Student (ID: <code>${targetUserId}</code>)</b>\n\n` +
                  `You can reply in two easy ways:\n` +
                  `1️⃣ <b>Swipe / Reply:</b> Simply swipe and reply to the message/receipt above directly in Telegram!\n` +
                  `2️⃣ <b>Command:</b> Copy and send this command with your message:\n\n` +
                  `<code>/reply ${targetUserId} </code>`,
            parse_mode: 'HTML'
        });
    }
}

// --- Message Handler ---
async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const caption = msg.caption || '';
    const userId = msg.from ? msg.from.id.toString() : chatId.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    const users = loadUsers();

    // Ensure User Record Exists
    if (!users[userId]) {
        users[userId] = {
            name: `${msg.from.first_name || 'Trader'} ${msg.from.last_name || ''}`.trim(),
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
                    text: `🔔 <b>New Referral / አዲስ ግብዣ!</b>\n\n<b>${escapeHTML(msg.from.first_name)}</b> started the bot using your link. When they enroll, you will earn <b>150 ETB commission</b>!`,
                    parse_mode: 'HTML'
                });
            }
        }
        saveUsers(users);
        syncToGoogle('sync_user', { user_id: userId, ...users[userId] });
    }

    // -------------------------------------------------------------
    // 💬 NATIVE TELEGRAM REPLY HANDLER (ADMIN SWIPES & REPLIES DIRECTLY)
    // -------------------------------------------------------------
    if (isAdmin && msg.reply_to_message) {
        const replyTargetMsg = msg.reply_to_message;
        let targetUserId = adminMessageMap[replyTargetMsg.message_id];

        // Fallback: extract target user ID from text or caption of replied-to message
        if (!targetUserId) {
            const sourceContent = (replyTargetMsg.text || '') + ' ' + (replyTargetMsg.caption || '');
            const match = sourceContent.match(/User ID:\s*<code>?(\d+)<\/code>?/i) ||
                          sourceContent.match(/🆔\s*<b>User ID:<\/b>\s*<code>?(\d+)<\/code>?/i) ||
                          sourceContent.match(/🆔\s*<code>?(\d+)<\/code>?/) ||
                          sourceContent.match(/User ID:\s*(\d+)/i) ||
                          sourceContent.match(/🆔\s*(\d+)/);
            if (match && match[1]) {
                targetUserId = match[1];
            }
        }

        if (targetUserId) {
            const replyContent = text || caption || '<i>(Attachment)</i>';

            if (msg.photo && msg.photo.length > 0) {
                const highestPhoto = msg.photo[msg.photo.length - 1];
                await sendTelegram('sendPhoto', {
                    chat_id: targetUserId,
                    photo: highestPhoto.file_id,
                    caption: `📩 <b>Message from ICE Academy Admin / ከአድሚን የተላከ መልዕክት:</b>\n\n${escapeHTML(caption)}`,
                    parse_mode: 'HTML'
                });
            } else {
                await sendTelegram('sendMessage', {
                    chat_id: targetUserId,
                    text: `📩 <b>Message from ICE Academy Admin / ከአድሚን የተላከ መልዕክት:</b>\n\n${escapeHTML(replyContent)}`,
                    parse_mode: 'HTML'
                });
            }

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Reply successfully sent to student!</b>\n🆔 <b>User ID:</b> <code>${targetUserId}</code>\n💬 <b>Your Reply:</b> ${escapeHTML(replyContent)}`,
                parse_mode: 'HTML'
            });
            return;
        }
    }

    // -------------------------------------------------------------
    // 📸 DIRECT PHOTO PAYMENT RECEIPT SUBMISSION
    // -------------------------------------------------------------
    if (msg.photo && msg.photo.length > 0) {
        const highestPhoto = msg.photo[msg.photo.length - 1];
        const orderId = `ORD-TG-${Date.now().toString().slice(-6)}`;
        const timestamp = new Date().toISOString();
        const studentName = `${msg.from.first_name || 'Student'} ${msg.from.last_name || ''}`.trim();
        const username = msg.from.username || 'N/A';
        const userCaption = caption ? caption.trim() : '';

        // Get Telegram direct photo file link and upload to Cloudinary
        let receiptUrl = '';
        try {
            const fileRes = await sendTelegram('getFile', { file_id: highestPhoto.file_id });
            if (fileRes && fileRes.data && fileRes.data.result && fileRes.data.result.file_path) {
                const tgDirectUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileRes.data.result.file_path}`;
                receiptUrl = await uploadToCloudinary(tgDirectUrl);
                if (!receiptUrl) receiptUrl = tgDirectUrl;
            }
        } catch (err) {
            console.error('Error fetching TG photo file:', err.message);
        }

        // Save order locally and sync with Google Sheets
        const orders = loadOrders();
        const orderData = {
            order_id: orderId,
            user_id: userId,
            name: studentName,
            phone: users[userId]?.phone || 'Via Telegram Photo',
            email: users[userId]?.email || 'Via Telegram Photo',
            telegram_username: username,
            broker_wallet_id: 'N/A',
            package_type: 'ICE 35-Day Mastery (Direct Photo)',
            price: '5,999 ETB',
            payment_method: 'TELEBIRR / DIRECT PHOTO',
            receipt_url: receiptUrl,
            tx_ref: userCaption || 'Telegram Photo Upload',
            status: 'PENDING',
            created_at: timestamp
        };
        orders[orderId] = orderData;
        saveOrders(orders);
        syncToGoogle('new_order', orderData);
        syncOrderToWebsite(orderData);

        // Notify Admin(s) with photo and actionable inline buttons
        const adminCaption = `🧾 <b>New Payment Receipt Received (Direct Photo)!</b>\n\n` +
            `👤 <b>Student:</b> ${escapeHTML(studentName)} (@${username})\n` +
            `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
            `🔢 <b>Order ID:</b> <code>${orderId}</code>\n` +
            `💰 <b>Amount:</b> 6,000 ETB (or $45 USDT)\n` +
            `📝 <b>Note / TxRef:</b> ${escapeHTML(userCaption) || '<i>(No caption provided)</i>'}\n` +
            `⏰ <b>Date:</b> ${new Date().toLocaleString()}\n\n` +
            `────────────────────\n` +
            `👉 <i>Check the screenshot above, then click Approve to generate and send the License Key automatically.</i>\n\n` +
            `💬 <b>Quick Reply / መልስ ለመስጠት፦</b>\n` +
            `1️⃣ <i>Swipe & Reply directly to this photo</i>\n` +
            `2️⃣ <i>Or copy and send:</i>\n` +
            `<code>/reply ${userId} Hello ${escapeHTML(studentName)}, </code>`;

        const adminKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Approve & Send License Key', callback_data: `approve_${orderId}` },
                    { text: '❌ Reject', callback_data: `reject_${orderId}` }
                ],
                [
                    { text: `💬 Reply to ${msg.from.first_name || 'Student'}`, callback_data: `replyprompt_${userId}` }
                ]
            ]
        };

        for (const adminId of ADMIN_IDS) {
            const photoRes = await sendTelegram('sendPhoto', {
                chat_id: adminId,
                photo: highestPhoto.file_id,
                caption: adminCaption,
                parse_mode: 'HTML',
                reply_markup: adminKeyboard
            });
            if (photoRes && photoRes.data && photoRes.data.result) {
                adminMessageMap[photoRes.data.result.message_id] = userId;
            }
        }

        // Confirmation to Student
        const studentConfirmation = `✅ <b>Payment Receipt Received! / የክፍያ ደረሰኝዎ ደርሶናል!</b>\n\n` +
            `🔢 <b>Order ID:</b> <code>${orderId}</code>\n` +
            `👤 <b>Name:</b> ${escapeHTML(studentName)}\n` +
            `📝 <b>Note:</b> ${escapeHTML(userCaption) || 'Receipt Screenshot'}\n\n` +
            `⏳ <b>EN:</b> ICE Admins are verifying your receipt screenshot. Your <b>License Key</b> and website login instructions will be sent here on Telegram shortly.\n\n` +
            `⏳ <b>AM:</b> አድሚኖች የላኩትን ደረሰኝ እያረጋገጡ ነው። የ <b>License Key</b> በአጭር ጊዜ ውስጥ በዚሁ ቴሌግራም ይደርስዎታል።\n\n` +
            `Thank you for choosing ICE Trading Academy! 🚀`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: studentConfirmation,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
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
                const payoutAdminMsg = `💰 <b>New Telebirr Commission Payout Request!</b>\n\n` +
                    `👤 <b>User:</b> ${escapeHTML(msg.from.first_name)} (@${msg.from.username || 'N/A'})\n` +
                    `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
                    `💵 <b>Amount:</b> <b>${currentPoints} ETB</b>\n` +
                    `📱 <b>Telebirr Phone:</b> <code>${telebirrPhone}</code>\n` +
                    `👤 <b>Account Name:</b> ${escapeHTML(fullName)}\n\n` +
                    `────────────────────\n` +
                    `Send confirmation to user after transfer:\n` +
                    `<code>/reply ${userId} Hello ${msg.from.first_name}, your commission of ${currentPoints} ETB has been sent via Telebirr (${telebirrPhone}). Thank you!</code>`;

                const payoutSent = await sendTelegram('sendMessage', {
                    chat_id: adminId,
                    text: payoutAdminMsg,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `💬 Reply to ${msg.from.first_name}`, callback_data: `replyprompt_${userId}` }]
                        ]
                    }
                });
                if (payoutSent && payoutSent.data && payoutSent.data.result) {
                    adminMessageMap[payoutSent.data.result.message_id] = userId;
                }
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
        const userFirstName = escapeHTML(msg.from.first_name || 'Trader');
        const welcomeMsg = `👋 <b>Welcome to ICE Trading Psychology Academy, ${userFirstName}!</b>\n` +
            `👋 <b>ሰላም ${userFirstName}፣ እንኳን ወደ ICE Trading Psychology Academy በሰላም መጡ!</b>\n\n` +
            `🧠 <b>ICE — Master Your Trading Psychology & Discipline</b>\n` +
            `ስሜትዎን ይቆጣጠሩ፣ የትሬዲንግ ፍርሃትን ያስወግዱ፣ ጠንካራ የሪስክ ማኔጅመንት ዲሲፕሊን ይገንቡ።\n\n` +
            `🌟 <b>Choose Your Path / የስልጠና አማራጮች፦</b>\n` +
            `1️⃣ <b>Telegram Group:</b> <code>1,000 ETB / $5 / mo</code>\n` +
            `   └ <i>Daily video lectures + 1 Live session/week</i>\n\n` +
            `2️⃣ <b>30-Day Mastery Program (Recommended):</b> <code>6,000 ETB / $45</code>\n` +
            `   └ <i>Full Curriculum + Daily Challenges + Progress Tracking</i>\n\n` +
            `3️⃣ <b>1-on-1 Mentorship:</b> <code>15,500 ETB / $100 / mo</code>\n` +
            `   └ <i>2x 45-min sessions/week + Daily Videos + Priority Q&A</i>\n\n` +
            `4️⃣ <b>Negadras Tier (50% Off):</b> <code>3,000 ETB</code>\n` +
            `   └ <i>Special 50% discount for Negadras Level 2 students</i>\n\n` +
            `🎁 <b>Broker Partner Discount:</b> <i>Get 30% OFF if you register with our partner broker link!</i>\n\n` +
            `👇 <b>Tap "💎 Enroll / Verify Payment" below to select your package, or send your payment screenshot directly here:</b>`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: welcomeMsg,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 👥 Referral Link
    if (text.startsWith('/ref') || text === '👥 Referral Link' || text === '👥 የእኔ ሪፈራል ሊንክ') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
        const refMsg = `👥 <b>Your Unique Referral Link / የእርስዎ የሪፈራል ሊንክ፦</b>\n\n` +
            `<code>${refLink}</code>\n\n` +
            `💡 <b>How it works / አሰራር፦</b>\n` +
            `Share this link with fellow traders. When they enroll in the ICE program, you earn <b>150 ETB commission</b> instantly added to your balance!\n` +
            `ይህንን ሊንክ ለትሬደር ጓደኞችዎ ያጋሩ። በእርስዎ ሊንክ ሲመዘገቡ <b>150 ብር ኮሚሽን</b> ያገኛሉ።\n\n` +
            `📅 <b>Payout Schedule:</b> Withdrawals are processed <b>every SUNDAY (እሁድ ቀን ብቻ)</b> via Telebirr.`;

        const sharePromoText = `🚀 ICE Trading Psychology Academy\n\n🧠 ስሜትዎን ይቆጣጠሩ፣ የትሬዲንግ ዲሲፕሊንዎን ያሳድጉ!\n💎 35-Day Practical Mastery Program\n\n👇 አሁኑኑ ተቀላቅለው ይመዝገቡ፦\n${refLink}`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: refMsg,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📤 Share with Friends / ለጓደኞችህ አጋራ", url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("🚀 ICE Trading Psychology Academy\n\n🧠 ስሜትዎን ይቆጣጠሩ፣ የትሬዲንግ ዲሲፕሊንዎን ያሳድጉ!\n💎 35-Day Practical Mastery Program\n\n👇 አሁኑኑ ተቀላቅለው ይመዝገቡ፦")}` }]
                ]
            }
        });
        return;
    }

    // 💰 My Balance
    if (text.startsWith('/balance') || text === '💰 My Balance' || text === '💰 የእኔ ባላንስ') {
        const balance = users[userId]?.points || 0;
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `💰 <b>Your Referral Balance / የእርስዎ ባላንስ፦</b> <b>${balance} ETB</b>\n\n` +
                `📅 <b>Payout Schedule:</b> Withdrawals are available <b>every SUNDAY (እሁድ ቀን ብቻ)</b> once a week.\n` +
                `የሪፈራል ኮሚሽን ማውጣት የሚቻለው በሳምንት አንድ ቀን (እሁድ ብቻ) ነው።\n\n` +
                `Minimum withdrawal threshold is <b>150 ETB</b>.`,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 🔑 My License Key
    if (text === '/key' || (!isAdmin && text.startsWith('/license')) || text === '🔑 My License Key' || text === '🔑 የእኔ ላይሰንስ ኪ') {
        const licenseKey = users[userId]?.license_key;
        if (licenseKey) {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `🔑 <b>Your Active License Key / የነቃው License Key፦</b>\n\n<code>${licenseKey}</code>\n\n` +
                    `Use this key on <a href="${WEBSITE_URL}">${WEBSITE_URL}</a> to access your course.`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
        } else {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>No active License Key found.</b>\n\nTo enroll and get your key, tap <b>"💎 Enroll / Verify Payment"</b> below or send your payment receipt photo directly here.`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
        }
        return;
    }

    // 📥 Withdraw Commission (SUNDAY ONLY / እሁድ ቀን ብቻ)
    if (text.startsWith('/withdraw') || text === '📥 Withdraw Commission' || text === '📥 ብር ማውጫ (Withdraw)') {
        const currentPoints = users[userId]?.points || 0;

        // Check Ethiopian / East Africa Time (EAT = UTC+3)
        const nowEAT = new Date(Date.now() + 3 * 3600 * 1000);
        const dayOfWeek = nowEAT.getUTCDay(); // 0 = Sunday

        if (dayOfWeek !== 0) {
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `📅 <b>Commission Payout Schedule / የብር ማውጫ መርሃ-ግብር</b>\n\n` +
                    `⚠️ <b>EN:</b> Commission withdrawals are processed <b>only on SUNDAYS (እሁድ ቀን ብቻ)</b> once a week.\n\n` +
                    `⚠️ <b>AM:</b> የሪፈራል ኮሚሽን ማውጣት የሚቻለው <b>በሳምንት አንድ ቀን (እሁድ ብቻ)</b> ነው።\n\n` +
                    `💰 <b>Your Current Balance / የእርስዎ ባላንስ፦</b> <b>${currentPoints} ETB</b>\n` +
                    `📅 <b>Next Payout Day:</b> This coming Sunday (የሚቀጥለው እሁድ)\n\n` +
                    `Please return on Sunday to request your Telebirr payout transfer!`,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD_EN
            });
            return;
        }

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
            text: `📥 <b>Telebirr Commission Withdrawal (Sunday Payout) / የቴሌብር ብር ማውጫ</b>\n\n` +
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
    if (text.startsWith('/website') || text === '🌐 Open Website' || text === '🌐 ዌብሳይቱን ክፈት (ICE)') {
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `🌐 <b>ICE Platform / ኦፊሳዊ ድህረ ገጽ፦</b>\n\n<a href="${WEBSITE_URL}">${WEBSITE_URL}</a>\n\nLogin with your registered email and License Key.`,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }

    // 📞 Support
    if (text.startsWith('/support') || text === '📞 Support' || text === '📞 ድጋፍ ሰጪ (Support)') {
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `📞 <b>ICE Academy Support Team:</b>\n\n` +
                `💬 <b>Direct Telegram Support:</b> You can write your question directly here in this bot chat! Our admins will reply promptly.\n` +
                `👉 Or message directly: @ic_ethiopia`,
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
                `└ <i>Approve order, sync license key with website DB, award inviter +150 ETB, and send credentials to student.</i>\n` +
                `💡 <i>Tip: Typing <code>/approve</code> alone automatically approves the latest pending order!</i>\n\n` +
                `❌ <b>/reject [order_id / user_id]</b>\n` +
                `└ <i>Reject payment verification and notify student.</i>\n\n` +
                `📋 <b>/pending</b> or <b>/orders</b>\n` +
                `└ <i>List all orders currently waiting for verification.</i>\n\n` +
                `📊 <b>/stats</b>\n` +
                `└ <i>View detailed user breakdown (Leads vs Enrolled Students).</i>\n\n` +
                `🔑 <b>/license &lt;email&gt;</b>\n` +
                `└ <i>Generate a 35-day license key synchronized with website database.</i>\n\n` +
                `💬 <b>Replying to Users (2 Methods):</b>\n` +
                `• <b>Method 1 (Instant):</b> Swipe & Reply directly to any user message/receipt in Telegram!\n` +
                `• <b>Method 2:</b> <code>/reply &lt;user_id&gt; &lt;message&gt;</code>\n\n` +
                `📢 <b>Targeted Broadcasts / መልዕክት ማሰራጫ፦</b>\n` +
                `• <code>/broadcast &lt;message&gt;</code> — Send to ALL users\n` +
                `• <code>/broadcast leads &lt;message&gt;</code> — Send ONLY to users who clicked /start but haven't enrolled yet\n` +
                `• <code>/broadcast students &lt;message&gt;</code> — Send ONLY to enrolled/paid students`;

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: helpMsg,
                parse_mode: 'HTML'
            });
            return;
        }

        // 5. /stats
        if (text === '/stats') {
            const allUsers = Object.keys(users);
            const enrolledUsers = allUsers.filter(uid => users[uid]?.has_purchased === true);
            const leadUsers = allUsers.filter(uid => !users[uid]?.has_purchased);

            const allOrders = Object.values(loadOrders());
            const approvedOrders = allOrders.filter(o => o.status === 'APPROVED').length;
            const pendingOrders = allOrders.filter(o => o.status === 'PENDING').length;

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `📊 <b>ICE Bot Statistics & Segmentation</b>\n\n` +
                    `👥 <b>Total Bot Users:</b> ${allUsers.length}\n` +
                    `🎯 <b>Leads (/start only, not yet enrolled):</b> ${leadUsers.length}\n` +
                    `🎓 <b>Enrolled Students (Paid & Licensed):</b> ${enrolledUsers.length}\n\n` +
                    `🛍️ <b>Total Orders:</b> ${allOrders.length}\n` +
                    `✅ <b>Approved Orders:</b> ${approvedOrders}\n` +
                    `⏳ <b>Pending Verification:</b> ${pendingOrders}\n\n` +
                    `<i>Use <code>/broadcast leads &lt;msg&gt;</code> to send special promotional offers to all ${leadUsers.length} leads!</i>`,
                parse_mode: 'HTML'
            });
            return;
        }

        // 6. /license <email> (Synced with Website DB)
        if (text.startsWith('/license')) {
            const parts = text.split(' ');
            const targetEmail = parts[1] ? parts[1].trim() : 'student@ice.com';
            const key = await getWebsiteLicenseKey();

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
                text: `✅ <b>Website-Synced License Key Generated!</b>\n\n🔑 <b>Key:</b> <code>${key}</code>\n📧 <b>Assigned Email:</b> ${targetEmail}\n🌐 <i>Active and ready on https://ice-psychology.pro.et</i>`,
                parse_mode: 'HTML'
            });
            return;
        }

        // 7. /reply
        if (text.startsWith('/reply')) {
            const parts = text.split(/\s+/);
            const targetId = parts[1];
            const replyMsg = parts.slice(2).join(' ');

            if (!targetId || !replyMsg) {
                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ <b>Usage:</b> <code>/reply &lt;user_id&gt; &lt;message&gt;</code>\nExample: <code>/reply 12345678 ሰላም፣ ጥያቄዎ ደርሶናል</code>`,
                    parse_mode: 'HTML'
                });
                return;
            }

            await sendTelegram('sendMessage', {
                chat_id: targetId,
                text: `📩 <b>Message from ICE Academy Admin / ከአድሚን የተላከ መልዕክት:</b>\n\n${escapeHTML(replyMsg)}`,
                parse_mode: 'HTML'
            });

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>Message successfully sent to user</b> (ID: <code>${targetId}</code>)!`,
                parse_mode: 'HTML'
            });
            return;
        }

        // 8. /broadcast (Targeted Segmentation)
        if (text.startsWith('/broadcast')) {
            const raw = text.replace('/broadcast', '').trim();
            if (!raw) {
                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ <b>Broadcast Usage:</b>\n\n` +
                        `• <code>/broadcast &lt;message&gt;</code> — All users\n` +
                        `• <code>/broadcast leads &lt;message&gt;</code> — Only /start users who haven't paid yet\n` +
                        `• <code>/broadcast students &lt;message&gt;</code> — Only enrolled students`,
                    parse_mode: 'HTML'
                });
                return;
            }

            let targetAudience = 'all';
            let broadcastMsg = raw;

            if (raw.toLowerCase().startsWith('leads ')) {
                targetAudience = 'leads';
                broadcastMsg = raw.substring(6).trim();
            } else if (raw.toLowerCase().startsWith('students ')) {
                targetAudience = 'students';
                broadcastMsg = raw.substring(9).trim();
            } else if (raw.toLowerCase().startsWith('all ')) {
                targetAudience = 'all';
                broadcastMsg = raw.substring(4).trim();
            }

            const allUserIds = Object.keys(users);
            let targetUserIds = [];

            if (targetAudience === 'leads') {
                targetUserIds = allUserIds.filter(uid => !users[uid]?.has_purchased);
            } else if (targetAudience === 'students') {
                targetUserIds = allUserIds.filter(uid => users[uid]?.has_purchased === true);
            } else {
                targetUserIds = allUserIds;
            }

            if (targetUserIds.length === 0) {
                await sendTelegram('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ No users found in the "<b>${targetAudience}</b>" segment.`,
                    parse_mode: 'HTML'
                });
                return;
            }

            let count = 0;
            for (const uid of targetUserIds) {
                await sendTelegram('sendMessage', {
                    chat_id: uid,
                    text: `📢 <b>ICE Academy Announcement</b>\n\n${broadcastMsg}`,
                    parse_mode: 'HTML'
                });
                count++;
            }

            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ Broadcast successfully sent to <b>${count}</b> users in segment (<b>${targetAudience}</b>)!`,
                parse_mode: 'HTML'
            });
            return;
        }
    }

    // -------------------------------------------------------------
    // 💬 DIRECT USER INQUIRY & SUPPORT MESSAGE FORWARDING (NON-ADMINS)
    // -------------------------------------------------------------
    if (!isAdmin && text.trim()) {
        const userFullName = `${msg.from.first_name || 'Trader'} ${msg.from.last_name || ''}`.trim();
        const username = msg.from.username || 'N/A';

        const adminSupportMsg = `📩 <b>New Support Message from User / አዲስ የተጠቃሚ መልዕክት</b>\n\n` +
            `👤 <b>From:</b> ${escapeHTML(userFullName)} (@${username})\n` +
            `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
            `⏰ <b>Time:</b> ${new Date().toLocaleString()}\n\n` +
            `💬 <b>Message:</b>\n<i>"${escapeHTML(text)}"</i>\n\n` +
            `────────────────────\n` +
            `💬 <b>Quick Reply / መልስ ለመስጠት፦</b>\n` +
            `1️⃣ <i>Swipe & Reply directly to this message</i>\n` +
            `2️⃣ <i>Or copy and send:</i>\n` +
            `<code>/reply ${userId} Hello ${escapeHTML(msg.from.first_name || 'Trader')}, </code>`;

        const replyKeyboard = {
            inline_keyboard: [
                [
                    { text: `💬 Reply to ${msg.from.first_name || 'User'}`, callback_data: `replyprompt_${userId}` }
                ]
            ]
        };

        for (const adminId of ADMIN_IDS) {
            const sentRes = await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: adminSupportMsg,
                parse_mode: 'HTML',
                reply_markup: replyKeyboard
            });
            if (sentRes && sentRes.data && sentRes.data.result) {
                adminMessageMap[sentRes.data.result.message_id] = userId;
            }
        }

        // Acknowledge to student
        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: `✅ <b>Your message has been sent to ICE Admins! / መልዕክትዎ ለአድሚኖች ደርሷል!</b>\n\n` +
                `We have received your message and will reply to you right here on Telegram shortly.\n` +
                `መልዕክትዎ ደርሶናል፤ አድሚኖች ተመልክተው በአጭር ጊዜ ውስጥ በዚሁ ቴሌግራም ይመልሱልዎታል።`,
            parse_mode: 'HTML',
            reply_markup: MAIN_KEYBOARD_EN
        });
        return;
    }
}

// -------------------------------------------------------------
// 🤖 AUTOMATIC TELEGRAM INITIALIZATION (WEBHOOK & COMMANDS)
// -------------------------------------------------------------
let isPollingActive = false;

async function startSafePolling() {
    if (isPollingActive) return;
    isPollingActive = true;
    console.log('🤖 Starting safe sequential Telegram polling...');

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, { drop_pending_updates: false });
    } catch (e) {}

    let offset = 0;
    while (isPollingActive) {
        try {
            const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
                params: { offset: offset, timeout: 20 },
                timeout: 25000
            });

            if (res.data && res.data.ok && Array.isArray(res.data.result) && res.data.result.length > 0) {
                for (const update of res.data.result) {
                    offset = update.update_id + 1;
                    if (update.callback_query) {
                        handleCallbackQuery(update.callback_query).catch(err => console.error('Callback error:', err));
                    } else if (update.message) {
                        handleMessage(update.message).catch(err => console.error('Message error:', err));
                    }
                }
            }
        } catch (err) {
            // Wait 2 seconds on network error before retrying
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function setupTelegram() {
    if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') return;

    // 1. Automatically register bot commands in Telegram (No BotFather manual typing needed!)
    try {
        console.log('📝 Registering Bot Commands with Telegram...');
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
            commands: [
                { command: 'start', description: '💎 Open Registration & Main Menu' },
                { command: 'balance', description: '💰 Check Referral Balance' },
                { command: 'withdraw', description: '📥 Withdraw Commission (Sundays)' },
                { command: 'support', description: '📞 Contact ICE Admin Support' }
            ]
        });
        console.log('✅ Bot commands registered with Telegram successfully!');
    } catch (err) {
        console.warn('⚠️ setMyCommands warning:', err.message);
    }

    // 2. Set Webhook if hosted on HTTPS (e.g. Render)
    const hostUrl = (process.env.RENDER_EXTERNAL_URL || process.env.WEB_URL || WEB_URL || '').replace(/\/$/, '');
    if (hostUrl && hostUrl.startsWith('https://')) {
        const webhookEndpoint = `${hostUrl}/api/telegram-webhook`;
        try {
            console.log(`🌐 Setting Telegram Webhook to: ${webhookEndpoint}...`);
            const setRes = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
                url: webhookEndpoint,
                drop_pending_updates: false
            });
            if (setRes.data && setRes.data.ok) {
                console.log(`✅ Telegram Webhook registered successfully at: ${webhookEndpoint}`);
                return; // Webhook active and handling all updates!
            }
        } catch (e) {
            console.error('❌ Failed to set Telegram Webhook:', e.response ? e.response.data : e.message);
        }
    }

    // Fallback: Use safe sequential polling
    startSafePolling();
}

// -------------------------------------------------------------
// ⏰ ANTI-SLEEP HEARTBEAT & WEBHOOK AUTO-HEALER (24/7 LIVE)
// -------------------------------------------------------------
const PING_INTERVAL_MS = 3 * 60 * 1000; // Check and ping every 3 minutes

function startKeepAlivePing() {
    const pingUrl = (process.env.RENDER_EXTERNAL_URL || process.env.WEB_URL || WEB_URL || 'https://icer.onrender.com').replace(/\/$/, '');
    const expectedWebhook = `${pingUrl}/api/telegram-webhook`;

    console.log(`⏰ Anti-Sleep & Webhook Auto-Healer activated for: ${pingUrl}`);
    setInterval(async () => {
        try {
            // 1. Keep Render instance alive
            await axios.get(`${pingUrl}/api/config`, { timeout: 8000 });
            console.log(`💓 Keep-Alive Ping sent at ${new Date().toLocaleTimeString()}`);
        } catch (e) {
            // Ignore ping network glitches
        }

        try {
            // 2. Auto-heal Telegram Webhook if hijacked or modified
            if (BOT_TOKEN && pingUrl.startsWith('https://')) {
                const infoRes = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`, { timeout: 6000 });
                if (infoRes.data && infoRes.data.result && infoRes.data.result.url !== expectedWebhook) {
                    console.warn(`⚠️ Webhook mismatch detected (${infoRes.data.result.url}). Auto-restoring to ${expectedWebhook}...`);
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
                        url: expectedWebhook,
                        drop_pending_updates: false
                    });
                    console.log(`✅ Webhook auto-restored to: ${expectedWebhook}`);
                }
            }
        } catch (err) {
            // Ignore webhook check errors
        }
    }, PING_INTERVAL_MS);
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
    await setupTelegram();
    startKeepAlivePing();
});
