import { findOrCreateUser } from '../services/userService.js';
import { checkSubscription } from '../services/subscriptionService.js';
import logger from '../utils/logger.js';
import { getTranslation } from '../utils/locales.js';
import { Markup } from 'telegraf';
import AdminLog from '../models/AdminLog.js';
import Channel from '../models/Channel.js';
import User from '../models/User.js';

const vipPromoMessages = [
    "🚀 <b>Tezkor yuklab olishni xohlaysizmi?</b>\n\n💎 VIP obuna bo'ling va cheklovsiz tezlikda yuklang!",
    "⭐️ <b>Reklamalardan charchadingizmi?</b>\n\n💎 VIP status oling va reklamasiz botdan foydalaning!",
    "🎬 <b>Yangi kinolarni birinchilardan bo'lib ko'ring!</b>\n\n💎 VIP foydalanuvchilar uchun eksklyuziv imkoniyatlar.",
    "🔒 <b>Maxfiy chat va ko'proq imkoniyatlar!</b>\n\n💎 VIP obuna bilan barchasiga ega bo'ling."
];
const rateLimitMap = new Map();
const strikesMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute
const BAN_THRESHOLD = 3; // Strikes before ban
const BAN_DURATION = 60 * 60 * 1000; // 1 hour

export const authMiddleware = async (ctx, next) => {
    if (!ctx.from) return next();

    const userId = ctx.from.id;

    // 🛡️ Rate Limiting & Anti-Flood
    const now = Date.now();
    const userRateData = rateLimitMap.get(userId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW, lastReq: 0 };

    // Check if rapid spam (requests < 500ms apart)
    if (now - userRateData.lastReq < 500 && userId.toString() !== process.env.ADMIN_ID) {
        const strikes = (strikesMap.get(userId) || 0) + 1;
        strikesMap.set(userId, strikes);

        if (strikes >= BAN_THRESHOLD) {
            // AUTO BAN
            const user = await findOrCreateUser(ctx);
            if (user && !user.isBanned) {
                user.isBanned = true;
                await user.save();

                // Log it
                await AdminLog.create({
                    adminId: 'SYSTEM',
                    action: 'auto_ban',
                    targetId: userId,
                    details: 'Anti-Flood Auto Ban (1 Hour)'
                });

                // Unlock after 1 hour
                setTimeout(async () => {
                    const u = await User.findOne({ telegramId: userId });
                    if (u) {
                        u.isBanned = false;
                        await u.save();
                    }
                }, BAN_DURATION);
            }
            strikesMap.delete(userId); // Reset strikes
            return ctx.reply('⛔️ <b>Siz spam tufayli 1 soatga bloklandingiz!</b>', { parse_mode: 'HTML' });
        }

        userRateData.lastReq = now;
        rateLimitMap.set(userId, userRateData);
        return ctx.reply('⚠️ <b>Iltimos, sekinroq yozing!</b> (Spam aniqlandi)', { parse_mode: 'HTML' });
    }

    userRateData.lastReq = now;

    if (now > userRateData.resetTime) {
        // Reset window
        userRateData.count = 1;
        userRateData.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
        userRateData.count++;
    }

    rateLimitMap.set(userId, userRateData);

    if (userRateData.count > MAX_REQUESTS_PER_WINDOW && userId.toString() !== process.env.ADMIN_ID) {
        logger.warn(`⚠️ Rate limit exceeded for user ${userId}`);
        return ctx.reply('⚠️ Juda ko\'p so\'rov! Biroz kuting va qayta urinib ko\'ring.');
    }

    try {
        const user = await findOrCreateUser(ctx);

        if (user && user.isBanned) {
            return ctx.reply('🚫 Siz botdan foydalana olmaysiz. (You are banned)');
        }

        // Store user in session
        if (!ctx.session) ctx.session = {};
        ctx.session.user = user;

        // Attach i18n helper
        const lang = user.language || 'uz';
        ctx.t = (key, params = {}) => getTranslation(lang, key, params);

        // Attach VIP check helper
        ctx.isVip = () => {
            return user && user.vipUntil && new Date(user.vipUntil) > new Date();
        };

        // Attach VIP promo helper
        ctx.showVipPromo = async (forceShow = false) => {
            // Only show to non-VIP users
            if (ctx.isVip() && !forceShow) return;

            const randomPromo = vipPromoMessages[Math.floor(Math.random() * vipPromoMessages.length)];

            try {
                await ctx.reply(randomPromo, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('💎 VIP Olish', 'vip_info')]
                    ])
                });
            } catch (e) {
                // Silently fail
            }
        };

        // 📢 MANDATORY SUBSCRIPTION CHECK - ALL USERS (including admin)
        try {
            const channels = await Channel.find({});
            logger.info(`📢 Subscription check: ${channels.length} channels found for user ${userId}`);

            if (channels.length > 0) {
                const notSubscribed = [];

                for (const ch of channels) {
                    try {
                        const member = await ctx.telegram.getChatMember(ch.channelId, userId);
                        logger.info(`Channel ${ch.name}: status = ${member.status}`);
                        if (!['member', 'administrator', 'creator'].includes(member.status)) {
                            notSubscribed.push(ch);
                        }
                    } catch (e) {
                        logger.error(`Channel ${ch.name} check failed:`, e.message);
                        // If can't check, assume not subscribed
                        notSubscribed.push(ch);
                    }
                }

                if (notSubscribed.length > 0) {
                    logger.info(`User ${userId} not subscribed to ${notSubscribed.length} channel(s)`);
                    const buttons = notSubscribed.map(ch => [
                        Markup.button.url(`📢 ${ch.name}`, ch.inviteLink.startsWith('http') ? ch.inviteLink : `https://${ch.inviteLink}`)
                    ]);
                    buttons.push([Markup.button.callback('✅ Tekshirish', 'check_subscription')]);

                    await ctx.reply(
                        '📢 <b>Botdan foydalanish uchun quyidagi kanallarga obuna bo\'ling:</b>\n\n<i>Obuna bo\'lgach, "✅ Tekshirish" tugmasini bosing.</i>',
                        {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard(buttons)
                        }
                    );
                    return; // Stop processing - user must subscribe first
                }
            }
        } catch (e) {
            logger.error('Subscription check error:', e);
            // Continue on error to not block users
        }

        return next();
    } catch (e) {
        logger.error('Auth middleware error:', e);
        // Default to uz on error
        ctx.t = (key, params = {}) => getTranslation('uz', key, params);
        ctx.isVip = () => false;
        ctx.showVipPromo = async () => { };
        return next();
    }
};

export const adminMiddleware = (ctx, next) => {
    try {
        const adminId = process.env.ADMIN_ID;
        if (!adminId || ctx.from.id.toString() !== adminId.toString()) {
            return ctx.reply("❌ Bu buyruq faqat admin uchun.");
        }
        return next();
    } catch (err) {
        logger.error('Admin Middleware Error:', err.message);
        return ctx.reply("❌ Xatolik yuz berdi.");
    }
};
