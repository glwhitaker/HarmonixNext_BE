# Harmonix Backend

This is the backend service for the **Harmonix** project, a music playlist generator that leverages the **OpenAI GPT** API to generate playlists based on user prompts, and the **Spotify API** to create and manage these playlists on the user's Spotify account.

## Features

- 🎧 **OpenAI GPT-4 API Integration**: Generates playlist recommendations based on user-defined moods or themes.
- 📜 **Spotify API Integration**: Authenticates users via Spotify and creates playlists directly in their Spotify accounts.
- 🛡 **Authentication**: Secure authentication using the Spotify OAuth 2.0 flow.
- ➕ **Add Tracks to Playlist**: Automatically add generated songs to a user's Spotify playlist.

## Tech Stack

- **Node.js**: Server-side JavaScript runtime.
- **Express.js**: Fast, minimalist web framework for Node.js.
- **OpenAI**: AI-powered text generation for music playlist recommendations.
- **Spotify Web API**: Spotify API for playlist creation and user data management.
