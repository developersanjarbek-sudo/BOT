import { Scenes, Markup } from 'telegraf';
import logger from '../utils/logger.js';
import User from '../models/User.js';

// Scene: Admin User Profile Search
const userProfileScene = new Scenes.WizardScene(
    'USER_PROFILE_SCENE',
    // Step 1: List all users AND request ID
    async (ctx) => {
        try {
            // First, get all users
            const users = await User.find().sort({ createdAt: -1 });
            const total = users.length;

            if (total === 0) {
                await ctx.reply('📭 Botda hozircha foydalanuvchilar mavjud emas.');
                return ctx.scene.leave();
            }

            // Send list of users (Can be long, so we format carefully)
            // Telegram message length limit is 4096 characters.
            // If there are too many users, sending all in one message is impossible.
            // We will send a summary or top 100 max to avoid errors, 
            // but the prompt says "barcha foydalanuvhcilarni", so we'll chunk it if necessary.
            
            let message = `👥 <b>Barcha foydalanuvchilar (${total} ta):</b>\n\n`;
            let messages = [];

            users.forEach((u, i) => {
                const line = `${i+1}. <b>${u.firstName || 'Nomsiz'}</b> ${u.username ? `(@${u.username})` : ''} | ID: <code>${u.telegramId}</code>\n`;
                if((message.length + line.length) > 4000) {
                    messages.push(message);
                    message = '';
                }
                message += line;
            });
            if(message.length > 0) messages.push(message);

            // Send all chunks
            for(let msg of messages) {
                await ctx.reply(msg, { parse_mode: 'HTML' });
            }

            // Finally, ask for ID
            await ctx.reply('🔍 <b>Profilga o\'tish uchun foydalanuvchi ID sini yuboring:</b>', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    Markup.button.callback('❌ Bekor qilish', 'cancel_profile_search')
                ])
            });

            return ctx.wizard.next();

        } catch (e) {
            logger.error('UserProfileScene step 1 error:', e);
            ctx.reply('❌ Xatolik yuz berdi.');
            return ctx.scene.leave();
        }
    },
    // Step 2: Receive ID and show profile
    async (ctx) => {
        try {
            if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_profile_search') {
                await ctx.answerCbQuery('❌ Bekor qilindi');
                await ctx.editMessageText('❌ Qidiruv bekor qilindi.');
                return ctx.scene.leave();
            }

            if (!ctx.message || !ctx.message.text) return;

            const query = ctx.message.text.trim();

            if (isNaN(query)) {
                await ctx.reply('⚠️ <b>Iltimos, faqat ID raqam yuboring!</b>', {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        Markup.button.callback('❌ Bekor qilish', 'cancel_profile_search')
                    ])
                });
                return; // stay in the current step
            }

            const targetId = parseInt(query);
            const user = await User.findOne({ telegramId: targetId });

            if (!user) {
                await ctx.reply(`📭 <b>ID qiyichi bo'yicha topilmadi:</b> <code>${targetId}</code>\n\nBoshqa ID raqam yozib ko'ring yoki bekor qiling.`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        Markup.button.callback('❌ Bekor qilish', 'cancel_profile_search')
                    ])
                });
                return; // wait for valid ID
            }

            // Show user profile
            await showUserProfile(ctx, user);
            return ctx.scene.leave();

        } catch (e) {
            logger.error('UserProfileScene step 2 error:', e);
            ctx.reply('❌ Xatolik yuz berdi.');
            return ctx.scene.leave();
        }
    }
);

async function showUserProfile(ctx, user) {
    const roleIcon = user.role === 'superadmin' ? '👑' : user.role === 'admin' ? '👮‍♂️' : '👤';
    const joinedDate = new Date(user.createdAt).toLocaleDateString();
    
    let vipStatus = '❌ Yo\'q';
    if (user.vipUntil && new Date(user.vipUntil) > new Date()) {
        const daysLeft = Math.ceil((new Date(user.vipUntil) - new Date()) / (1000 * 60 * 60 * 24));
        vipStatus = `✅ Mavjud (${daysLeft} kun qoldi)`;
    }

    const message = `${roleIcon} <b>Foydalanuvchi Profili</b>\n\n` +
                    `📝 <b>Ism:</b> ${user.firstName || 'Kiritilmagan'}\n` +
                    `🌐 <b>Username:</b> ${user.username ? `@${user.username}` : 'Mavjud emas'}\n` +
                    `🆔 <b>ID:</b> <code>${user.telegramId}</code>\n\n` +
                    `📅 <b>Ro'yxatdan o'tgan:</b> ${joinedDate}\n` +
                    `🎬 <b>Ko'rilgan kinolar:</b> ${user.moviesWatched || 0} ta\n` +
                    `💎 <b>VIP Holati:</b> ${vipStatus}\n` +
                    `🚫 <b>Bloklangan:</b> ${user.isBanned ? 'Ha ❌' : 'Yo\'q ✅'}`;

    const tgLinkButton = Markup.button.url('↗️ Profilga o\'tish', `tg://user?id=${user.telegramId}`);
    
    await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[tgLinkButton]])
    });
}

export default userProfileScene;
