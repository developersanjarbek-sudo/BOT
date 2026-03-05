import User from '../models/User.js';
import logger from '../utils/logger.js';

export const findOrCreateUser = async (ctx) => {
    const { id, first_name, username } = ctx.from;
    try {
        // First try to find existing user
        let user = await User.findOne({ telegramId: id });

        if (user) {
            // Update existing user's info if changed
            if (user.firstName !== first_name || user.username !== username) {
                user.firstName = first_name;
                user.username = username;
                await user.save();
            }
            return user;
        }

        // Create new user if not exists
        user = await User.create({
            telegramId: id,
            firstName: first_name,
            username,
        });
        return user;

    } catch (error) {
        // If duplicate key error, just find the user
        if (error.code === 11000) {
            return await User.findOne({ telegramId: id });
        }
        logger.error('Error in findOrCreateUser:', error);
        // Return a minimal user object to prevent crash
        return { telegramId: id, firstName: first_name, isBanned: false };
    }
};

export const updateUser = async (telegramId, data) => {
    try {
        return await User.findOneAndUpdate({ telegramId }, data, { new: true });
    } catch (error) {
        logger.error('Error updating user:', error);
        return null;
    }
};

export const getUserByTelegramId = async (telegramId) => {
    try {
        return await User.findOne({ telegramId });
    } catch (error) {
        logger.error('Error getting user:', error);
        return null;
    }
};
