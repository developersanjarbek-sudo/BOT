import { Markup } from 'telegraf';
import logger from '../utils/logger.js';
import { getMovieByCode, searchMovies, getAllMovies, getTopMovies } from '../services/movieService.js';
import Favorite from '../models/Favorite.js';
import Movie from '../models/Movie.js';
import User from '../models/User.js';
import { getUserByTelegramId } from '../services/userService.js';
import PromoCode from '../models/PromoCode.js';
import { sendMainMenu } from '../utils/menuUtils.js';

// Helper function to send movie
const sendMovie = async (ctx, movie, dbUser) => {
    try {
        // VIP Check
        const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();

        // Increment views using updateOne (movie might be plain object from aggregate)
        if (movie._id) {
            await Movie.updateOne({ _id: movie._id }, { $inc: { views: 1 } }).catch(() => { });
        }
        const views = (movie.views || 0) + 1;

        // Watermark for caption
        const userWatermark = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;

        let caption = ctx.t('movie_found', {
            title: movie.title,
            year: movie.year || 'N/A',
            genre: movie.genre || 'N/A',
            rating: movie.averageRating || '0.0',
            views: views
        });

        if (movie.description) {
            caption += `\n📝 ${movie.description}\n`;
        }
        caption += `\n👤 User: ${userWatermark}`;

        // Add Restricted Warning
        if (movie.isRestricted) {
            caption += `\n\n⚠️ <i>Ushbu kino qat'iy himoyalangan va uni yuklab olib bo'lmaydi. Faqat shu bot ichida ko'rish mumkin.</i>`;
        }

        // Increment User Watched Count (if DBUser exists)
        if (dbUser) {
            await User.findByIdAndUpdate(dbUser._id, {
                $inc: { moviesWatched: 1 },
                $push: {
                    watchHistory: {
                        $each: [{ movie: movie._id }],
                        $slice: -20 // Keep only last 20
                    }
                }
            });
        }

        // Check if already favorite
        let isFav = false;
        if (dbUser && dbUser._id) {
            try {
                isFav = await Favorite.findOne({ user: dbUser._id, movie: movie._id });
            } catch (e) { }
        }

        const buttons = [
            [Markup.button.callback(isFav ? '💔' : '❤️', `fav_${movie._id}`)],
            [Markup.button.callback(ctx.t('menu_vip'), `review_${movie.code}`), Markup.button.callback('💬', `read_reviews_${movie.code}`)]
        ];

        // Sharing is VIP-only, and blocked entirely if movie is restricted
        if (isVip && !movie.isRestricted) {
            buttons.push([Markup.button.callback('📤', `share_${movie.code}`)]);
        }

        // 💎 VIP Promo Button for non-VIP users
        if (!isVip) {
            buttons.push([Markup.button.callback('💎 VIP Olish - Eksklyuziv!', 'vip_info')]);
        } else {
            // VIP Report Button
            buttons.push([Markup.button.callback('⚠️ Shikoyat', `report_${movie.code}`)]);
        }

        // Send video for all users, but lock forwarding/saving if restricted or non-VIP
        if (movie.fileId) {
            try {
                // Video sending with protection
                await ctx.replyWithVideo(movie.fileId, {
                    caption,
                    parse_mode: 'HTML',
                    protect_content: movie.isRestricted ? true : !isVip,
                    thumb: movie.poster || undefined,
                    ...Markup.inlineKeyboard(buttons)
                });

                if (!isVip && dbUser && (dbUser.moviesWatched || 0) % 3 === 0) {
                    setTimeout(() => ctx.showVipPromo?.(), 2000);
                }

                return true;
            } catch (e) {
                logger.error('Video send error:', e);
                // Fallback if video fails not implemented to avoid leak, better fail.
                throw e;
            }
        }

        // If has link, show download only for VIP and if NOT restricted
        if (movie.link && isVip && !movie.isRestricted) {
            buttons.unshift([Markup.button.url('📥 Download', movie.link)]);
        }

        if (movie.poster) {
            try {
                await ctx.replyWithPhoto(movie.poster, {
                    caption,
                    parse_mode: 'HTML',
                    protect_content: movie.isRestricted ? true : !isVip,
                    ...Markup.inlineKeyboard(buttons)
                });

                if (!isVip && dbUser && (dbUser.moviesWatched || 0) % 3 === 0) {
                    setTimeout(() => ctx.showVipPromo?.(), 2000);
                }

                return true;
            } catch (e) {
                logger.error('Photo send error:', e);
            }
        }

        // Fallback to text
        await ctx.replyWithHTML(caption, Markup.inlineKeyboard(buttons));
        return true;
    } catch (error) {
        logger.error('sendMovie error:', error);
        await ctx.reply(ctx.t('error_general')).catch(() => { });
        return false;
    }
};

export const setupUserCommands = (bot) => {

    // Handle "🔍 Kino qidirish"
    bot.hears(['🔍 Kino qidirish', '🔍 Поиск фильмов', '🔍 Search Movies'], (ctx) => {
        ctx.reply(ctx.t('search_prompt'), { parse_mode: 'HTML' }).catch(() => { });
    });

    // Handle "🆕 Yangi kinolar"
    bot.hears(['🆕 Yangi kinolar', '🆕 Новинки', '🆕 New Movies'], async (ctx) => {
        try {
            const movies = await getAllMovies();
            if (!movies || movies.length === 0) {
                return ctx.reply(ctx.t('not_found'));
            }

            const recent = movies.slice(0, 10);
            let message = '🆕 <b>New Movies:</b>\n\n';
            recent.forEach((m, i) => {
                message += `${i + 1}. 🎬 ${m.title} — <code>${m.code}</code>\n`;
            });
            message += '\n<i>Send code to watch!</i>';

            // Aggressive VIP Promo
            const dbUser = await getUserByTelegramId(ctx.from.id);
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();
            const buttons = [];
            if (!isVip) {
                buttons.push([Markup.button.callback('💎 VIP Olish - Eksklyuziv!', 'vip_info')]);
            }

            await ctx.replyWithHTML(message, Markup.inlineKeyboard(buttons));
        } catch (e) {
            logger.error('New movies error:', e);
            ctx.reply(ctx.t('error_general')).catch(() => { });
        }
    });

    // Handle "🔥 Top kinolar"
    bot.hears(['🔥 Top kinolar', '🔥 Топ фильмы', '🔥 Top Movies'], async (ctx) => {
        try {
            const movies = await getTopMovies(10);
            if (!movies || movies.length === 0) {
                return ctx.reply(ctx.t('not_found'));
            }

            let message = ctx.t('menu_top') + ':\n\n';
            movies.forEach((m, i) => {
                message += `${i + 1}. 🎬 ${m.title} — 👁 ${m.views}\nCode: <code>${m.code}</code>\n\n`;
            });

            // Aggressive VIP Promo
            const dbUser = await getUserByTelegramId(ctx.from.id);
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();
            const buttons = [];
            if (!isVip) {
                buttons.push([Markup.button.callback('💎 VIP Olish', 'vip_info')]);
            }

            await ctx.replyWithHTML(message, Markup.inlineKeyboard(buttons));
        } catch (e) {
            logger.error('Top movies error:', e);
            ctx.reply(ctx.t('error_general')).catch(() => { });
        }
    });

    // Handle "⏳ VIP Status"
    bot.hears(['⏳ VIP Vaqti', '⏳ Время VIP', '⏳ VIP Time'], async (ctx) => {
        try {
            const user = await getUserByTelegramId(ctx.from.id);
            if (user && user.vipUntil && new Date(user.vipUntil) > new Date()) {
                const now = new Date();
                const diff = new Date(user.vipUntil) - now;

                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

                await ctx.reply(ctx.t('vip_time_remaining', { days, hours, minutes }), { parse_mode: 'HTML' });
            } else {
                await ctx.reply(ctx.t('vip_expired') + '\n\n' + ctx.t('vip_promo_start'), {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(ctx.t('vip_button_get'), 'vip_info')]
                    ])
                });
            }
        } catch (e) {
            logger.error('VIP status error:', e);
        }
    });

    // Handle "📜 Mening Tarixim" (VIP Only)
    bot.hears(['📜 Mening Tarixim', '📜 История', '📜 History'], async (ctx) => {
        try {
            const dbUser = await User.findOne({ telegramId: ctx.from.id }).populate({
                path: 'watchHistory.movie',
                select: 'title code'
            });

            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();

            if (!isVip) {
                return ctx.reply(ctx.t('vip_restricted') + '\n\n' + ctx.t('vip_promo_start'), {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(ctx.t('vip_button_get'), 'vip_info')]
                    ])
                });
            }

            if (!dbUser || !dbUser.watchHistory || dbUser.watchHistory.length === 0) {
                return ctx.reply('📭 ' + (ctx.t('not_found') || 'History is empty.'));
            }

            // Show history (reversed to show latest first)
            const history = dbUser.watchHistory.slice().reverse();
            let msg = '📜 <b>' + (ctx.t('menu_history') || 'Mening Tarixim') + '</b>\n\n';

            history.forEach((h, i) => {
                if (h.movie) {
                    msg += `${i + 1}. 🎬 ${h.movie.title} — <code>${h.movie.code}</code>\n`;
                }
            });

            msg += '\n<i>Send code to watch again!</i>';
            await ctx.replyWithHTML(msg);
        } catch (e) {
            logger.error('History error:', e);
            ctx.reply('❌ Error');
        }
    });

    // Handle "⭐ Sevimlilar"
    bot.hears(['⭐ Sevimlilar', '❤️ Избранное', '❤️ Favorites'], async (ctx) => {
        try {
            const dbUser = await getUserByTelegramId(ctx.from.id);

            // 1. VIP CHECK FIRST
            // If user doesn't exist, they can't be VIP. If they do, check expiration.
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();

            if (!isVip) {
                return ctx.reply(ctx.t('vip_restricted_fav') + '\n\n' + ctx.t('vip_promo_start'), {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(ctx.t('vip_button_get'), 'vip_info')]
                    ])
                });
            }

            if (!dbUser) {
                return ctx.reply(ctx.t('not_found'));
            }

            // Only VIPs reach here, so no need for promo buttons
            const buttons = [];

            const favorites = await Favorite.find({ user: dbUser._id }).populate('movie');

            if (!favorites || favorites.length === 0) {
                return ctx.reply('📭 <b>Empty</b>', { parse_mode: 'HTML' });
            }

            let msg = '⭐ <b>Favorites:</b>\n\n';
            favorites.forEach((f, i) => {
                if (f.movie) {
                    msg += `${i + 1}. 🎬 ${f.movie.title} — <code>${f.movie.code}</code>\n`;
                }
            });

            // Only VIPs reach here, so no need for promo buttons
            // Buttons empty for VIP

            await ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
        } catch (e) {
            logger.error('Favorites error:', e);
            ctx.reply(ctx.t('error_general')).catch(() => { });
        }
    });

    // Handle Text (Search or Code)
    bot.on('text', async (ctx, next) => {
        try {
            // If user is currently in a Scene/Wizard, do not treat text as global search.
            // This prevents second commands/messages from being interpreted as previous step input.
            if (ctx.scene?.current) {
                return next();
            }

            // Helper to check if text is a known button
            const isButton = Object.values(ctx.session?.user?.language ? {} : {}).some(val => val === ctx.message.text);
            // Better: use a hardcoded list of all possible button texts across languages to skip
            const buttonTexts = [
                '🔍 Kino qidirish', '🆕 Yangi kinolar', '⭐ Sevimlilar', '📂 Kategoriyalar',
                '➕ Kino qo\'shish', '📊 Statistika', '📢 Reklama yuborish', '🗑️ Kino o\'chirish',
                '🔥 Top kinolar', '📝 Kinolar ro\'yxati', '👥 Foydalanuvchilar',
                '🔥 Top kinolar', '📝 Kinolar ro\'yxati', '👥 Foydalanuvchilar',
                '🏠 Bosh menyu', '🔥 Top kinolar', '📊 Mening statistikam', '💎 VIP Boshqaruv',
                ' Ovoz berish', '⚙️ Sozlamalar', '⏳ VIP Vaqti', '📜 Mening Tarixim',
                '🛍 Do\'kon', '🎁 Kunlik Bonus', '🗣 Do\'stlarni taklif qilish',
                '🎫 Promokod', '🎫 Promo Code', '🎫 Промокод', // Promokod tugmalari
                '💎 VIP Olish', '🎰 Tasodifiy Kino', '❌ Bekor qilish', // VIP va boshqa tugmalar
                // Ru
                '🏠 Главное меню', '🔍 Поиск фильмов', '📂 Категории', '🆕 Новинки', '❤️ Избранное',
                '🔥 Топ фильмы', '📊 Моя статистика', '💎 VIP Управление', ' Голосование', '⚙️ Настройки', '⏳ Время VIP', '📜 История',
                // En
                '🏠 Main Menu', '🔍 Search Movies', '📂 Categories', '🆕 New Movies', '❤️ Favorites',
                '🔥 Top Movies', '📊 My Stats', '💎 VIP Management', '🗳 Vote', '⚙️ Settings', '⏳ VIP Time', '📜 History'
            ];

            if (!ctx.message?.text || ctx.message.text.startsWith('/') || buttonTexts.includes(ctx.message.text)) {
                return next();
            }

            const text = ctx.message.text.trim();

            // Check if number (Code)
            if (/^\d+$/.test(text)) {
                const code = parseInt(text);
                const movie = await getMovieByCode(code);

                if (movie) {
                    const dbUser = await User.findOne({ telegramId: ctx.from.id }).catch(() => null);
                    await sendMovie(ctx, movie, dbUser);
                } else {
                    ctx.reply(ctx.t('not_found')).catch(() => { });
                }
            } else {
                // Search by title
                const movies = await searchMovies(text);
                if (!movies || movies.length === 0) {
                    return ctx.reply(ctx.t('not_found'), { parse_mode: 'HTML' });
                }

                let msg = `🔎 <b>"${text}" :</b>\n\n`;
                movies.slice(0, 10).forEach((m, i) => {
                    msg += `${i + 1}. 🎬 ${m.title} — <code>${m.code}</code>\n`;
                });
                msg += '\n<i>Send code!</i>';
                msg += '\n<i>Send code!</i>';

                // Aggressive VIP Promo
                const dbUser = await getUserByTelegramId(ctx.from.id);
                const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();
                const buttons = [];
                if (!isVip) {
                    buttons.push([Markup.button.callback('💎 VIP Olish - Eksklyuziv!', 'vip_info')]);
                }

                await ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
            }
        } catch (error) {
            logger.error('Text handler error:', error);
            // Don't crash, just skip
        }
    });

    // Handle Callbacks
    bot.action(/fav_(.+)/, async (ctx) => {
        try {
            const dbUser = await getUserByTelegramId(ctx.from.id);
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();

            // 🔒 RESTRICTION: Favorites are VIP Only
            if (!isVip) {
                return ctx.answerCbQuery(ctx.t('vip_restricted_fav'), { show_alert: true });
            }

            const movieId = ctx.match[1];
            // dbUser already fetched above
            if (!dbUser) return ctx.answerCbQuery('❌');

            const exists = await Favorite.findOne({ user: dbUser._id, movie: movieId });
            if (exists) {
                await Favorite.findOneAndDelete({ user: dbUser._id, movie: movieId });
                return ctx.answerCbQuery('💔');
            } else {
                await Favorite.create({ user: dbUser._id, movie: movieId });
                return ctx.answerCbQuery('❤️');
            }
        } catch (e) {
            ctx.answerCbQuery('❌').catch(() => { });
        }
    });

    bot.action(/share_(.+)/, async (ctx) => {
        try {
            const code = ctx.match[1];
            const botUsername = ctx.botInfo?.username || 'bot';
            const shareUrl = `https://t.me/${botUsername}?start=${code}`;

            await ctx.reply(`📤 <b>Link:</b>\n\n<code>${shareUrl}</code>`, { parse_mode: 'HTML' });
            ctx.answerCbQuery('📤').catch(() => { });
        } catch (e) {
            ctx.answerCbQuery('❌').catch(() => { });
        }
    });


    bot.action(/review_(\d+)/, async (ctx) => {
        try {
            const code = parseInt(ctx.match[1]);
            const dbUser = await getUserByTelegramId(ctx.from.id);

            // VIP CHECK for Review
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();
            if (!isVip) {
                return ctx.answerCbQuery(ctx.t('vip_only_comment'), { show_alert: true });
            }

            ctx.scene.enter('REVIEW_SCENE', { movieCode: code });
            ctx.answerCbQuery();
        } catch (e) {
            logger.error('Review entering error:', e);
        }
    });

    // Handle Read Reviews
    bot.action(/read_reviews_(\d+)/, async (ctx) => {
        try {
            const code = parseInt(ctx.match[1]);
            const movie = await getMovieByCode(code);

            if (!movie || !movie.reviews || movie.reviews.length === 0) {
                return ctx.answerCbQuery(ctx.t('not_found'), { show_alert: true });
            }

            // 🔒 RESTRICTION: Read Reviews are VIP Only
            const dbUser = await getUserByTelegramId(ctx.from.id);
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();
            if (!isVip) {
                return ctx.answerCbQuery(ctx.t('vip_restricted_review'), { show_alert: true });
            }

            // Show last 5 reviews
            const reviews = movie.reviews.slice(-5).reverse();
            let msg = `💬 <b>"${movie.title}" reviews:</b>\n\n`;

            reviews.forEach(r => {
                const stars = '⭐️'.repeat(r.rating || 0);
                msg += `👤 <b>${r.userName}</b> (${stars})\n📝 <i>${r.comment}</i>\n\n`;
            });

            await ctx.replyWithHTML(msg);
            ctx.answerCbQuery();
        } catch (e) {
            ctx.answerCbQuery('❌');
        }
    });

    // 🗣 Referral System (Invite)
    bot.hears(['🗣 Do\'stlarni taklif qilish', '🗣 Invite Friends', '🗣 Пригласить друзей'], async (ctx) => {
        const botUsername = ctx.botInfo.username;
        const link = `https://t.me/${botUsername}?start=${ctx.from.id}`;
        await ctx.replyWithHTML(ctx.t('referral_promo', { link }), { disable_web_page_preview: true });
    });

    // 🎁 Daily Bonus
    bot.hears(['🎁 Kunlik Bonus', '🎁 Daily Bonus', '🎁 Ежедневный бонус'], async (ctx) => {
        try {
            const user = await getUserByTelegramId(ctx.from.id);
            const now = new Date();

            // Check cooldown (24 hours) - actually user said "Daily".
            // Let's check if lastDailyBonus was today (in user's timezone? strict 24h is cleaner)
            // Simple: if lastDailyBonus is not today's date (UTC)

            const last = user.lastDailyBonus ? new Date(user.lastDailyBonus) : null;
            const isSameDay = last && last.getDate() === now.getDate() && last.getMonth() === now.getMonth() && last.getFullYear() === now.getFullYear();

            if (isSameDay) {
                return ctx.reply('⏳ <b>Ertaga keling!</b>\n\nSiz bugungi bonusni olgansiz.', { parse_mode: 'HTML' });
            }

            user.points = (user.points || 0) + 25;
            user.lastDailyBonus = now;
            await user.save();

            ctx.reply(ctx.t('bonus_claimed', { points: user.points }), { parse_mode: 'HTML' });
        } catch (e) {
            ctx.reply('❌ Error');
        }
    });

    // 🛍 Shop
    bot.hears(['🛍 Do\'kon', '🛍 Shop', '🛍 Магазин'], async (ctx) => {
        try {
            const user = await getUserByTelegramId(ctx.from.id);
            const msg = ctx.t('shop_welcome', { points: user.points || 0 });

            await ctx.replyWithHTML(msg, Markup.inlineKeyboard([
                [Markup.button.callback('💎 7 Kun - 5000 Ball', 'buy_vip_7')]
            ]));
        } catch (e) { }
    });

    // Shop Action
    bot.action('buy_vip_7', async (ctx) => {
        try {
            const user = await getUserByTelegramId(ctx.from.id);
            if (user.points >= 5000) {
                user.points -= 5000;

                // Add VIP
                let currentVip = user.vipUntil && new Date(user.vipUntil) > new Date() ? new Date(user.vipUntil) : new Date();
                user.vipUntil = new Date(currentVip.getTime() + 7 * 24 * 60 * 60 * 1000);
                user.vipNotified = false;
                await user.save();

                // Log
                await AdminLog.create({
                    adminId: 'SYSTEM',
                    action: 'shop_buy_vip',
                    targetId: user.telegramId,
                    details: 'Bought 7 days VIP for 5000 pts'
                });

                ctx.answerCbQuery('✅ Muvaffaqiyatli!');

                // VIP ogohlantirish xabari
                const vipNoticeMsg = `🔄 <b>MUHIM!</b>\n\n` +
                    `Sizning VIP obunangiz <b>aktiv</b> bo'ldi.\n\n` +
                    `💎 <b>VIP imkoniyatlar:</b>\n` +
                    `├ 🎬 Barcha kinolarga cheklovsiz kirish\n` +
                    `├ 💬 Sharh qoldirish va o'qish\n` +
                    `├ ⭐ Sevimlilar ro'yxati\n` +
                    `├ 📜 Ko'rish tarixi\n` +
                    `├ 🎰 Tasodifiy kino\n` +
                    `├ 🎫 Promokod ishlatish\n` +
                    `└ ⚠️ Shikoyat yuborish\n\n` +
                    `<i>Quyidagi menyu yangilandi, davom etishingiz mumkin.</i>`;

                await ctx.telegram.sendMessage(ctx.from.id, vipNoticeMsg, { parse_mode: 'HTML' });

                // AUTO REFRESH MENU
                setTimeout(() => sendMainMenu(ctx), 500); // Refresh menu
            } else {
                ctx.answerCbQuery('❌ Ball yetarli emas!', { show_alert: true });
                ctx.telegram.sendMessage(ctx.from.id, ctx.t('shop_fail'), { parse_mode: 'HTML' });
            }
        } catch (e) { }
    });

    // 🎫 Promokod (Handler)
    bot.hears(['🎫 Promokod', '🎫 Promo Code', '🎫 Промокод'], async (ctx) => {
        logger.info('🎫 Promokod handler triggered by user:', ctx.from.id);
        try {
            await ctx.scene.enter('REDEEM_PROMO_SCENE');
        } catch (e) {
            logger.error('Promo scene enter error:', e);
            await ctx.reply('❌ Xatolik yuz berdi. Qayta urinib ko\'ring.');
        }
    });

    // ⚠️ Report Action
    bot.action(/report_(\d+)/, async (ctx) => {
        try {
            const code = ctx.match[1];
            const dbUser = await getUserByTelegramId(ctx.from.id);
            const isVip = dbUser && dbUser.vipUntil && new Date(dbUser.vipUntil) > new Date();

            // VIP tekshiruvi
            if (!isVip) {
                return ctx.answerCbQuery('⚠️ Shikoyat yuborish faqat VIP foydalanuvchilar uchun!', { show_alert: true });
            }

            await ctx.answerCbQuery('� Shikoyat yozing...');
            return ctx.scene.enter('REPORT_SCENE', { movieCode: code });
        } catch (e) {
            logger.error('Report error:', e);
            ctx.answerCbQuery('❌ Xatolik yuz berdi!', { show_alert: true });
        }
    });

    // 🎰 Random Movie (VIP Only)
    bot.hears(['🎰 Tasodifiy Kino', '🎰 Random Movie'], async (ctx) => {
        try {
            const isVip = ctx.isVip();
            if (!isVip) {
                return ctx.showVipPromo();
            }

            const movies = await Movie.aggregate([{ $sample: { size: 1 } }]);
            if (!movies || movies.length === 0) {
                return ctx.reply('❌ Hozircha kinolar yo\'q.');
            }

            const movie = movies[0];
            const dbUser = await User.findOne({ telegramId: ctx.from.id });

            await ctx.reply(`🎲 <b>Tasodifiy tanlandi!</b>`, { parse_mode: 'HTML' });
            await sendMovie(ctx, movie, dbUser);

        } catch (e) {
            logger.error('Random movie error:', e);
            ctx.reply('❌ Xatolik yuz berdi.');
        }
    });

    bot.action('vip_info', async (ctx) => {
        try {
            const message = `💎 <b>VIP OBUNA - Premium Tajriba!</b>\n\n` +
                `✨ <b>VIP Imtiyozlari:</b>\n` +
                `├ 🚀 Tezkor yuklab olish\n` +
                `├ 📥 Cheklovsiz yuklash\n` +
                `├ 🔓 Barcha kinolarga kirish\n` +
                `├ 💬 Sharh qoldirish\n` +
                `├ 🎬 Kino so'rash imkoniyati\n` +
                `└ ⭐ Maxsus VIP Badge\n\n` +
                `💰 <b>Narxlar:</b>\n` +
                `├ 🔹 7 kun — <b>10,000 so'm</b>\n` +
                `├ 🔹 30 kun — <b>30,000 so'm</b> (eng ommabop!)\n` +
                `└ 🔹 90 kun — <b>80,000 so'm</b> (tejamkor!)\n\n` +
                `📞 <b>To'lov uchun:</b> @sanjarbek_404\n\n` +
                `<i>💡 VIP oling va kinolardan to'liq bahramand bo'ling!</i>`;

            await ctx.replyWithHTML(message, Markup.inlineKeyboard([
                [Markup.button.url('📞 Adminga yozish', 'https://t.me/sanjarbek_404')]
            ]));
            ctx.answerCbQuery();
        } catch (error) {
            logger.error('VIP Info Handler Error:', error);
            ctx.answerCbQuery('❌ Xatolik yuz berdi.').catch(() => { });
        }
    });
};
