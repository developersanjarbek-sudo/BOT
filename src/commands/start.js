import { Markup } from 'telegraf';
import Movie from '../models/Movie.js';
import User from '../models/User.js';
import { getUserByTelegramId } from '../services/userService.js';
import Favorite from '../models/Favorite.js';
import { getTranslation } from '../utils/locales.js';
import { sendMainMenu } from '../utils/menuUtils.js';
import { checkSubscription } from '../services/subscriptionService.js';
import logger from '../utils/logger.js';

export const setupStartCommand = (bot) => {
    // /help
    bot.command('help', async (ctx) => {
        try {
            // If user was in some wizard/scene, exit it to avoid treating command as step input
            if (ctx.scene?.current) {
                await ctx.scene.leave().catch(() => { });
            }

            const msg = `ℹ️ <b>Yordam va buyruqlar</b>\n\n` +
                `- /start — Botni ishga tushirish\n` +
                `- /help — Yordam\n` +
                `- /myrole — Mening hisob ma'lumotlarim\n` +
                `- /premium — VIP/Premium haqida\n` +
                `- /support — Qo'llab-quvvatlash\n\n` +
                `<i>Kinoni topish uchun nomini yoki kodini yuboring.</i>`;

            await ctx.reply(msg, { parse_mode: 'HTML' });
        } catch (e) {
            logger.error('Help command error:', e);
        }
    });

    // /myrole
    bot.command('myrole', async (ctx) => {
        try {
            if (ctx.scene?.current) {
                await ctx.scene.leave().catch(() => { });
            }

            const user = await User.findOne({ telegramId: ctx.from.id }).catch(() => null);
            const role = user?.role || 'user';
            const isVip = user && user.vipUntil && new Date(user.vipUntil) > new Date();

            let msg = `👤 <b>Mening hisobim</b>\n\n`;
            msg += `- ID: <code>${ctx.from.id}</code>\n`;
            msg += `- Username: ${ctx.from.username ? '@' + ctx.from.username : '—'}\n`;
            msg += `- Role: <b>${role}</b>\n`;
            msg += `- VIP: <b>${isVip ? '✅ Aktiv' : '❌ Yo\'q'}</b>`;

            await ctx.reply(msg, { parse_mode: 'HTML' });
        } catch (e) {
            logger.error('MyRole command error:', e);
        }
    });

    // /premium
    bot.command('premium', async (ctx) => {
        try {
            if (ctx.scene?.current) {
                await ctx.scene.leave().catch(() => { });
            }

            const msg = `💎 <b>VIP/Premium</b>\n\n` +
                `VIP bo'lsangiz:\n` +
                `- 🔓 Barcha kinolarga kirish\n` +
                `- 💬 Sharhlar (o'qish/yozish)\n` +
                `- ⭐ Sevimlilar\n` +
                `- 📜 Tarix\n` +
                `- 🎫 Promokod ishlatish\n\n` +
                `<i>VIP olish uchun menyudan "💎 VIP Olish" tugmasini bosing.</i>`;

            await ctx.reply(msg, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.callback('💎 VIP Olish', 'vip_info')]])
            });
        } catch (e) {
            logger.error('Premium command error:', e);
        }
    });

    // /support
    bot.command('support', async (ctx) => {
        try {
            if (ctx.scene?.current) {
                await ctx.scene.leave().catch(() => { });
            }

            const msg = `📞 <b>Qo'llab-quvvatlash</b>\n\n` +
                `Savol yoki muammo bo'lsa adminga yozing:\n` +
                `- @sanjarbek_404`;

            await ctx.reply(msg, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.url('📞 Adminga yozish', 'https://t.me/sanjarbek_404')]])
            });
        } catch (e) {
            logger.error('Support command error:', e);
        }
    });

    bot.start(async (ctx) => {
        try {
            // Check if started with movie code (deep link)
            const startPayload = ctx.message?.text?.split(' ')[1];

            // If deep link exists, we might still want to ensure language is set?
            // For now, let's keep deep link logic simple, assuming language defaults to 'uz' via middleware if not set.
            if (startPayload && /^\d+$/.test(startPayload)) {
                // ... Existing Deep Link Logic (Simplified for brevity, but I should keep it or refactor)
                // RE-INSERTING DEEP LINK LOGIC BELOW
                const movie = await Movie.findOne({ code: parseInt(startPayload) }).catch(() => null);
                if (movie) {
                    movie.views = (movie.views || 0) + 1;
                    await movie.save().catch(() => { });

                    const dbUser = await getUserByTelegramId(ctx.from.id).catch(() => null);
                    const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();

                    // Use ctx.t for dynamic text? Deep link usually needs quick access. 
                    // Let's rely on middleware default 'uz' if user is new.
                    let caption = ctx.t('movie_found', {
                        title: movie.title,
                        year: movie.year || 'N/A',
                        genre: movie.genre || 'N/A',
                        rating: movie.averageRating || '0.0',
                        views: movie.views
                    });

                    if (movie.description) caption += `\n📝 ${movie.description}\n`;

                    if (movie.isRestricted) {
                        caption += `\n\n⚠️ <i>Ushbu kino qat'iy himoyalangan va uni yuklab olib bo'lmaydi. Faqat shu bot ichida ko'rish mumkin.</i>`;
                    }

                    const buttons = [
                        [Markup.button.callback('❤️', `fav_${movie._id}`)],
                        [Markup.button.callback(ctx.t('menu_vip'), `review_${movie.code}`)]
                    ];

                    if (isVip && !movie.isRestricted) {
                        buttons[0].push(Markup.button.callback('📤', `share_${movie.code}`));
                    } else if (!isVip) {
                        buttons.push([Markup.button.callback('💎 VIP Olish - Eksklyuziv!', 'vip_info')]);
                    }

                    if (movie.fileId) {
                        await ctx.replyWithVideo(movie.fileId, {
                            caption,
                            parse_mode: 'HTML',
                            protect_content: movie.isRestricted ? true : !isVip,
                            ...Markup.inlineKeyboard(buttons)
                        });
                        return;
                    }
                    // ... other media types
                    await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
                    return;
                }
            }

            // 🔒 Mandatory Subscription Check
            const subStatus = await checkSubscription(ctx);
            if (subStatus !== true && Array.isArray(subStatus) && subStatus.length > 0) {
                const buttons = subStatus.map(ch => [Markup.button.url(`➕ ${ch.name}`, ch.inviteLink)]);
                buttons.push([Markup.button.callback(ctx.t('sub_btn_check'), 'check_subscription')]);

                return ctx.reply(ctx.t('sub_check_msg'), {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(buttons)
                });
            }

            // Normal Start - Check Language
            let user = await User.findOne({ telegramId: ctx.from.id });

            // REFERRAL LOGIC (New User)
            if (!user) {
                const startPayload = ctx.message?.text?.split(' ')[1];
                if (startPayload && /^\d+$/.test(startPayload) && startPayload !== ctx.from.id.toString()) {
                    const referrerId = parseInt(startPayload);
                    const referrer = await User.findOne({ telegramId: referrerId });

                    if (referrer) {
                        // Increment Referrer Count
                        referrer.referralCount = (referrer.referralCount || 0) + 1;

                        // MILESTONE: Every 10 invites = 24 Hours VIP
                        if (referrer.referralCount % 10 === 0) {
                            const twentyFourHours = 24 * 60 * 60 * 1000;
                            let currentVip = referrer.vipUntil && new Date(referrer.vipUntil) > new Date() ? new Date(referrer.vipUntil) : new Date();
                            referrer.vipUntil = new Date(currentVip.getTime() + twentyFourHours);

                            try {
                                await ctx.telegram.sendMessage(referrerId, ctx.t('referral_milestone'), { parse_mode: 'HTML' });
                            } catch (e) { }
                        } else {
                            // Progress Notification
                            const left = 10 - (referrer.referralCount % 10);
                            try {
                                await ctx.telegram.sendMessage(referrerId, ctx.t('referral_progress', { count: referrer.referralCount, left }), { parse_mode: 'HTML' });
                            } catch (e) { }
                        }
                        await referrer.save();

                        // Mark new user as invited
                        try {
                            user = await User.create({
                                telegramId: ctx.from.id,
                                firstName: ctx.from.first_name,
                                username: ctx.from.username,
                                invitedBy: referrerId.toString()
                            });
                        } catch (e) {
                            // Ignore duplicate key error if race condition
                            user = await User.findOne({ telegramId: ctx.from.id });
                        }
                    }
                }
            }

            if (!user || !user.language) {
                return ctx.reply(getTranslation('uz', 'language_select'), {
                    ...Markup.keyboard([
                        ['🇺🇿 O\'zbekcha', '🇷🇺 Русский', '🇬🇧 English']
                    ]).resize()
                });
            }

            // If Language is Set -> Show Menu
            sendMainMenu(ctx);

        } catch (error) {
            logger.error('Start command error:', error);
        }
    });

    // Language Handlers
    const setLanguage = async (ctx, langCode) => {
        try {
            const user = await User.findOne({ telegramId: ctx.from.id });
            if (user) {
                user.language = langCode;
                await user.save();
                ctx.session.user = user; // Update session
                ctx.t = (key, params) => getTranslation(langCode, key, params); // Update helper immediately
            }

            // 1. Confirm Language
            await ctx.reply(ctx.t('lang_changed'), Markup.removeKeyboard());

            // 2. AGGRESSIVE VIP PROMO (As requested)
            await ctx.reply(ctx.t('vip_promo_start'), {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(ctx.t('vip_button_get'), 'vip_info')]
                ])
            });

            // 3. Show Main Menu
            sendMainMenu(ctx);
        } catch (e) {
            logger.error('Set Lang Error:', e);
        }
    };

    bot.hears('🇺🇿 O\'zbekcha', (ctx) => setLanguage(ctx, 'uz'));
    bot.hears('🇷🇺 Русский', (ctx) => setLanguage(ctx, 'ru'));
    bot.hears('🇬🇧 English', (ctx) => setLanguage(ctx, 'en'));

    // Send Main Menu (Delegated to util)
    const handleMainMenu = (ctx) => sendMainMenu(ctx);

    // VIP Olish button handler for non-VIP users
    bot.hears('💎 VIP Olish', async (ctx) => {
        const message = `💎 <b>VIP OBUNA - Premium Tajriba!</b>\n\n` +
            `✨ <b>VIP Imtiyozlari:</b>\n` +
            `├ 📥 Tezkor yuklab olish\n` +
            `├ 🔓 Barcha kinolarga kirish\n` +
            `├ 💬 Sharh qoldirish\n` +
            `├ 🎬 Kino so'rash imkoniyati\n` +
            `└ ⭐ Maxsus VIP Badge\n\n` +
            `💰 <b>Narxlar:</b>\n` +
            `├ 🔹 7 kun — <b>10,000 so'm</b>\n` +
            `├ 🔹 30 kun — <b>30,000 so'm</b> (eng ommabop!)\n` +
            `└ 🔹 90 kun — <b>80,000 so'm</b> (tejamkor!)\n\n` +
            `<i>💡 VIP oling va kinolardan to'liq bahramand bo'ling!</i>`;

        await ctx.replyWithHTML(message, Markup.inlineKeyboard([
            [Markup.button.callback('💎 Sotib olish', 'vip_info')]
        ]));
    });

    // Helper for Settings Menu
    bot.hears(['⚙️ Sozlamalar', '⚙️ Настройки', '⚙️ Settings'], (ctx) => {
        ctx.reply(ctx.t('settings_title'), {
            ...Markup.keyboard([
                ['🇺🇿 O\'zbekcha', '🇷🇺 Русский', '🇬🇧 English'],
                [ctx.t('menu_main')]
            ]).resize()
        });
    });

    // Back to Menu
    bot.hears(['🏠 Bosh menyu', '🏠 Главное меню', '🏠 Main Menu'], (ctx) => sendMainMenu(ctx));

    // Stats Handler (Updated with VIP promo)
    bot.hears(['📊 Mening statistikam', '📊 Моя статистика', '📊 My Stats'], async (ctx) => {
        try {
            const user = await User.findOne({ telegramId: ctx.from.id });
            const isVip = user && user.vipUntil && new Date(user.vipUntil) > new Date();
            const favCount = await Favorite.countDocuments({ user: user._id }).catch(() => 0);

            let msg = `📊 <b>${ctx.t('menu_stats')}</b>\n\n`;
            msg += `👤 <b>Ism:</b> ${user.firstName}\n`;
            msg += `❤️ <b>Sevimlilar:</b> ${favCount} ta\n`;
            msg += `🎬 <b>Ko'rilgan kinolar:</b> ${user.moviesWatched || 0} ta\n\n`;

            if (isVip) {
                const daysLeft = Math.ceil((new Date(user.vipUntil) - new Date()) / (1000 * 60 * 60 * 24));
                msg += `💎 <b>VIP Status:</b> ✅ AKTIV\n`;
                msg += `📅 <b>Qolgan kunlar:</b> ${daysLeft} kun\n`;
            } else {
                msg += `👤 <b>Status:</b> Oddiy foydalanuvchi\n\n`;
                msg += `💎 <i>VIP bo'ling va ko'proq imkoniyatlarga ega bo'ling!</i>`;
            }

            const buttons = [];
            if (!isVip) {
                buttons.push([Markup.button.callback('💎 VIP Olish', 'vip_info')]);
            }

            await ctx.reply(msg, {
                parse_mode: 'HTML',
                ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {})
            });
        } catch (e) {
            logger.error('Stats error:', e);
        }
    });

    // 🗳 Vote / Request Movie Handler (VIP Only)
    bot.hears(['🗳 Ovoz berish', '🗳 Голосование', '🗳 Vote'], async (ctx) => {
        try {
            const user = await User.findOne({ telegramId: ctx.from.id });
            const isVip = user && user.vipUntil && new Date(user.vipUntil) > new Date();

            if (!isVip) {
                return ctx.reply(ctx.t('vip_restricted'));
            }

            ctx.scene.enter('REQUEST_SCENE');
        } catch (e) {
            logger.error('Vote handler error:', e);
        }
    });
    // Check Subscription Callback
    bot.action('check_subscription', async (ctx) => {
        try {
            const subStatus = await checkSubscription(ctx);
            if (subStatus === true) {
                await ctx.deleteMessage().catch(() => { });
                await ctx.reply(ctx.t('sub_success'), { parse_mode: 'HTML' });
                sendMainMenu(ctx);
            } else {
                await ctx.answerCbQuery(ctx.t('sub_fail'), { show_alert: true });
            }
        } catch (e) {
            ctx.answerCbQuery('Error');
        }
    });
};
