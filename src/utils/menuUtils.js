import { Markup } from 'telegraf';
import { getUserByTelegramId } from '../services/userService.js';
import logger from './logger.js';

export const sendMainMenu = async (ctx) => {
    try {
        // Fetch fresh user data from CACHE (drastically faster)
        const user = await getUserByTelegramId(ctx.from.id);
        const isVip = user && user.vipUntil && new Date(user.vipUntil) > new Date();

        // Store fresh user in session
        if (user) ctx.session.user = user;

        // Define buttons using ctx.t
        let menu = [
            [ctx.t('menu_search'), ctx.t('menu_category')],
            [ctx.t('menu_new'), ctx.t('menu_fav')],
            [ctx.t('menu_top'), ctx.t('menu_stats')]
        ];

        if (isVip) {
            menu.push([ctx.t('menu_vote'), ctx.t('menu_history')]); // VIP Extras (Chat removed)
            menu.push([ctx.t('menu_vip_status'), ctx.t('menu_shop')]); // Status & Shop
            menu.push([ctx.t('menu_invite'), '🎫 Promokod']); // Invite & Promo
            menu.push(['🎰 Tasodifiy Kino']); // Random Movie
        } else {
            // 💎 VIP Promo button for non-VIP users
            menu.push(['💎 VIP Olish']);
            menu.push([ctx.t('menu_shop'), ctx.t('menu_bonus')]); // Shop & Bonus
            menu.push([ctx.t('menu_invite')]); // Invite only (no Promo for non-VIP)
        }

        menu.push([ctx.t('menu_settings')]); // Settings button

        // Welcome message with VIP status
        let welcomeMsg = ctx.t('welcome', { name: ctx.from.first_name });
        if (isVip) {
            const daysLeft = Math.ceil((new Date(user.vipUntil) - new Date()) / (1000 * 60 * 60 * 24));
            welcomeMsg += `\n\n💎 <b>VIP Status:</b> Aktiv (${daysLeft} kun qoldi)`;
        }

        await ctx.reply(welcomeMsg, {
            parse_mode: 'HTML',
            ...Markup.keyboard(menu).resize()
        });
    } catch (error) {
        logger.error('Send Main Menu Error:', error);
        ctx.reply(ctx.t('error_general'));
    }
};
