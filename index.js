import express from 'express';
import dotenv from 'dotenv';
import connectDB from './src/config/db.js';
import bot from './src/bot/bot.js';

dotenv.config();

// Main startup function
const startBot = async () => {
    try {
        // Connect to Database first
        await connectDB();
        console.log('✅ Database connected');

        // Express Server for Uptime/Webhook
        const app = express();
        const PORT = process.env.PORT || 3000;

        app.get('/', (req, res) => {
            res.send('🎥 Kino Bot is running...');
        });

        app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date() });
        });

        app.listen(PORT, () => {
            console.log(`🌐 Server running on port ${PORT}`);
        });

        // Launch Bot
        await bot.launch();
        console.log('🤖 Bot started successfully!');

    } catch (err) {
        console.error('❌ Startup failed:', err);
        process.exit(1);
    }
};

// Start the application
startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Prevent Crash on Unhandled Errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    // Don't exit, keep running
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Don't exit, keep running
});
