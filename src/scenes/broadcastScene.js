import { Scenes, Markup } from 'telegraf';
import logger from '../utils/logger.js';
import User from '../models/User.js';

const broadcastScene = new Scenes.WizardScene(
    'BROADCAST_SCENE',
    // Step 1: Ask for message
    async (ctx) => {
        try {
            await ctx.reply('📢 <b>Reklama yuborish</b>\n\nYuboriladigan xabar, rasm yoki videoni yuboring:', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Bekor qilish', 'cancel_broadcast')]
                ])
            });
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Broadcast Stats Error:', e);
            await ctx.reply('❌ Xatolik: ' + e.message);
        }
    },
    // Step 2: Handle Input & Ask Audience
    async (ctx) => {
        try {
            if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_broadcast') {
                await ctx.answerCbQuery('Bekor qilindi').catch(() => { });
                try { await ctx.editMessageText('❌ Bekor qilindi.'); } catch (e) { }
                return ctx.scene.leave();
            }

            if (!ctx.message) return; // Ignore if not message

            // Save message details
            ctx.wizard.state.message = {};
            if (ctx.message.text) {
                ctx.wizard.state.message.type = 'text';
                ctx.wizard.state.message.content = ctx.message.text;
            } else if (ctx.message.photo) {
                ctx.wizard.state.message.type = 'photo';
                ctx.wizard.state.message.fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                ctx.wizard.state.message.caption = ctx.message.caption;
            } else if (ctx.message.video) {
                ctx.wizard.state.message.type = 'video';
                ctx.wizard.state.message.fileId = ctx.message.video.file_id;
                ctx.wizard.state.message.caption = ctx.message.caption;
            } else {
                return ctx.reply('⚠️ Faqat matn, rasm yoki video yuboring.');
            }

            await ctx.reply('🎯 <b>Kimlarga yuborilsin?</b>', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👥 Barchaga', 'target_all')],
                    [Markup.button.callback('💎 Faqat VIP larga', 'target_vip')],
                    [Markup.button.callback('❌ Bekor qilish', 'cancel_broadcast')]
                ])
            });
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Broadcast step 2 error:', e);
            return ctx.scene.leave();
        }
    },
    // Step 3: Handle Target Selection
    async (ctx) => {
        try {
            if (!ctx.callbackQuery) return;

            const target = ctx.callbackQuery.data;
            if (target === 'cancel_broadcast') {
                await ctx.answerCbQuery('Bekor qilindi');
                await ctx.editMessageText('❌ Bekor qilindi.');
                return ctx.scene.leave();
            }

            ctx.wizard.state.target = target;
            let filter = { isBanned: false };
            let targetName = 'Barcha foydalanuvchilar';

            if (target === 'target_vip') {
                filter.vipUntil = { $gt: new Date() };
                targetName = '💎 VIP Foydalanuvchilar';
            }

            const count = await User.countDocuments(filter).catch(() => 0);

            ctx.wizard.state.filter = filter;

            await ctx.editMessageText(`📋 <b>Tasdiqlash:</b>\n\n🎯 Auditoriya: ${targetName}\n👥 Soni: ${count} ta\n\nXabar turi: ${ctx.wizard.state.message.type}`, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Yuborish', 'confirm_send')],
                    [Markup.button.callback('❌ Bekor qilish', 'cancel_broadcast')]
                ])
            });
            return ctx.wizard.next();
        } catch (e) {
            logger.error('Broadcast step 3 error:', e);
            return ctx.scene.leave();
        }
    },
    // Step 4: Final Sender
    async (ctx) => {
        try {
            // Step is mainly driven by confirm_send/cancel_broadcast actions.
            // If user sends something else here, just remind.
            if (ctx.callbackQuery) return;
            return ctx.reply('✅ Yuborish uchun "✅ Yuborish" tugmasini bosing yoki bekor qiling.');
        } catch (e) {
            return ctx.scene.leave();
        }
    }
);

broadcastScene.action('confirm_send', async (ctx) => {
    try {
        const filter = ctx.wizard.state.filter;
        const msgData = ctx.wizard.state.message;
        const users = await User.find(filter);

        await ctx.answerCbQuery('Yuborilmoqda...');
        await ctx.editMessageText(`🚀 Xabar yuborish boshlandi... 0/${users.length}`);

        let success = 0;
        let failed = 0;

        for (let i = 0; i < users.length; i++) {
            const userId = users[i].telegramId;
            try {
                if (msgData.type === 'text') {
                    await ctx.telegram.sendMessage(userId, `📢 <b>Admin:</b>\n\n${msgData.content}`, { parse_mode: 'HTML' });
                } else if (msgData.type === 'photo') {
                    await ctx.telegram.sendPhoto(userId, msgData.fileId, { caption: msgData.caption ? `📢 <b>Admin:</b>\n\n${msgData.caption}` : undefined, parse_mode: 'HTML' });
                } else if (msgData.type === 'video') {
                    await ctx.telegram.sendVideo(userId, msgData.fileId, { caption: msgData.caption ? `📢 <b>Admin:</b>\n\n${msgData.caption}` : undefined, parse_mode: 'HTML' });
                }
                success++;
            } catch (e) {
                failed++;
            }

            if (i % 20 === 0 && i > 0) {
                try { await ctx.editMessageText(`🚀 Yuborilmoqda... ${i}/${users.length}`); } catch (e) { }
            }
        }

        await ctx.editMessageText(`✅ <b>Tugatildi!</b>\n\n✅ Muvaffaqiyatli: ${success}\n❌ Xatolik: ${failed}`, { parse_mode: 'HTML' });
        return ctx.scene.leave();

    } catch (e) {
        logger.error('Broadcast execute error:', e);
        ctx.reply('❌ Xatolik yuz berdi.').catch(() => { });
        return ctx.scene.leave();
    }
});

broadcastScene.action('cancel_broadcast', async (ctx) => {
    try {
        await ctx.editMessageText('❌ Bekor qilindi.');
    } catch (e) { }
    return ctx.scene.leave();
});

// Some setups may not route callbackQuery to scene.action reliably.
// Provide explicit handlers as fallback while scene is active.
broadcastScene.action(['target_all', 'target_vip'], async (ctx) => {
    // Let wizard step 3 handle it
    return ctx.wizard.selectStep(2)(ctx);
});

broadcastScene.action(['confirm_send', 'cancel_broadcast'], async (ctx) => {
    // Let dedicated handlers handle it
    return;
});

export default broadcastScene;
