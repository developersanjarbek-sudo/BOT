import Movie from '../models/Movie.js';
import logger from '../utils/logger.js';

export const createMovie = async (movieData) => {
    try {
        return await Movie.create(movieData);
    } catch (error) {
        logger.error('Create movie error:', error);
        throw error;
    }
};

export const getMovieByCode = async (code) => {
    try {
        return await Movie.findOne({ code });
    } catch (error) {
        logger.error('Get movie by code error:', error);
        return null;
    }
};

export const searchMovies = async (query) => {
    try {
        return await Movie.find({ title: { $regex: query, $options: 'i' } }).limit(20);
    } catch (error) {
        logger.error('Search movies error:', error);
        return [];
    }
};

export const deleteMovie = async (code) => {
    try {
        return await Movie.findOneAndDelete({ code });
    } catch (error) {
        logger.error('Delete movie error:', error);
        return null;
    }
};

export const getAllMovies = async () => {
    try {
        return await Movie.find().sort({ createdAt: -1 });
    } catch (error) {
        logger.error('Get all movies error:', error);
        return [];
    }
};

export const countMovies = async () => {
    try {
        return await Movie.countDocuments();
    } catch (error) {
        logger.error('Count movies error:', error);
        return 0;
    }
};

export const getTopMovies = async (limit = 10) => {
    try {
        return await Movie.find().sort({ views: -1 }).limit(limit);
    } catch (error) {
        logger.error('Get top movies error:', error);
        return [];
    }
};

export const getMoviesByGenre = async (genre) => {
    try {
        return await Movie.find({ genre: { $regex: genre, $options: 'i' } });
    } catch (error) {
        logger.error('Get movies by genre error:', error);
        return [];
    }
};

export const updateMovie = async (code, data) => {
    try {
        return await Movie.findOneAndUpdate({ code }, data, { new: true });
    } catch (error) {
        logger.error('Update movie error:', error);
        return null;
    }
};
