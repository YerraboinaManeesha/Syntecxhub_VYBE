# 💬 VYBE — Real-Time Chat Application

**VYBE** is a full-stack real-time chat application that enables users to communicate through private conversations and group chats. It provides real-time messaging, online presence, typing indicators, user profiles, and voice and video calling features through a responsive interface.

The application combines **React.js**, **Node.js**, **Express.js**, **MongoDB**, and **Socket.IO** to deliver interactive and real-time communication.

## 🌐 Live Demo

[**VYBE — Live Application**](https://vybe-z326.onrender.com/)



## ✨ Features

- 🔐 User Registration & Login
- 🔒 Secure Authentication with HTTP-Only Cookies
- 💬 Private One-to-One Chats
- 👥 Group Conversations
- ⚡ Real-Time Messaging
- 🟢 Online Presence Indicators
- ✍️ Typing Indicators
- 🔔 Unread Message Counts
- 👤 User Profiles
- 👥 Group Member Management
- 📞 Voice & Video Calling
- 📋 Call History & Records
- 🗄️ Persistent Message Storage
- 📱 Responsive User Interface
- 🚪 Logout Functionality

## 🧠 Application Flow

```text
User Opens VYBE
        ↓
Register / Login
        ↓
Authentication & Session Validation
        ↓
Open Private Chat or Group Chat
        ↓
Send and Receive Messages
        ↓
Socket.IO Real-Time Communication
        ↓
Online Status + Typing Indicators
        ↓
Messages Stored in MongoDB
        ↓
Voice / Video Calling and Call History
```

## 🛠️ Tech Stack

| **Technology** | **Purpose** |
|---|---|
| React.js | Frontend UI development |
| Vite | Frontend development and build tool |
| JavaScript | Application logic |
| HTML5 | Web page structure |
| CSS3 | Styling and responsive design |
| Node.js | Backend runtime |
| Express.js | REST API development |
| MongoDB | Database |
| Mongoose | Database modeling and queries |
| Socket.IO | Real-time messaging and communication |
| Socket.IO Client | Frontend socket connection |
| JSON Web Tokens (JWT) | Authentication |
| bcryptjs | Password hashing |
| Zod | Input validation |
| Helmet | HTTP security headers |
| CORS | Cross-origin request configuration |
| Render | Application deployment |
| Git & GitHub | Version control and source code hosting |

## 📂 Project Structure

```text
Syntecxhub_VYBE/
│
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/
│   ├── public/
│   ├── package.json
│   └── .env.example
│
├── server/
│   ├── src/
│   │   └── index.js
│   ├── package.json
│   └── .env.example
│
├── .gitignore
└── README.md
```

*The directory structure above is illustrative; your actual source folders may contain additional files.*

## 🔐 Environment Variables

### Backend

Create a `.env` file inside the `server` directory.

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_private_jwt_secret
CLIENT_ORIGIN=http://localhost:5173
COOKIE_SAMESITE=lax
```

### Frontend

Create a `.env` file inside the `client` directory.

```env
VITE_API_URL=http://localhost:5000/api
```

**Important:**
- Replace placeholder values with your own configuration.
- Never upload actual database credentials or JWT secrets to GitHub.
- Configure production environment variables in Render.
- Set `CLIENT_ORIGIN` to the deployed frontend URL in production.
- Configure cookie security settings appropriately for cross-origin HTTPS requests.

## ⚙️ Run Locally

### 1. Clone the Repository

```bash
git clone https://github.com/YerraboinaManeesha/Syntecxhub_VYBE.git
cd Syntecxhub_VYBE
```

### 2. Install Backend Dependencies

```bash
cd server
npm install
```

Create the backend `.env` file with the required environment variables.

### 3. Start the Backend

```bash
npm run dev
```

The backend runs on the configured port, typically `5000`.

### 4. Install Frontend Dependencies

Open a second terminal:

```bash
cd client
npm install
```

Create the frontend `.env` file and configure `VITE_API_URL`.

### 5. Start the Frontend

```bash
npm run dev
```

Open the local URL provided by Vite, typically:

[http://localhost:5173](http://localhost:5173)

## 🚀 Deployment

The application is deployed using **Render**.

### Frontend

- **Service Type:** Static Site
- **Root Directory:** `client`
- **Build Command:** `npm ci && npm run build`
- **Publish Directory:** `dist`

**Live App:** https://vybe-z326.onrender.com/

### Backend

- **Service Type:** Web Service
- **Root Directory:** `server`
- **Build Command:** `npm ci`
- **Start Command:** `npm start`

**Backend URL:** https://vybe-backend-udd9.onrender.com


The frontend communicates with the backend through API requests and Socket.IO. Both services require the appropriate production environment configuration.

*Note: Render free instances may spin down after inactivity, causing a delay when the application is opened or used again.*

## 🎯 Future Improvements

- ✅ Message Read Receipts
- 📎 File and Media Sharing
- 🛡️ Enhanced Group Administration
- 🔔 Advanced Notification Features
- ⚙️ Additional Account Settings
- 🔍 Message Search
- 🎨 More Chat Customization Options

## 👩‍💻 Author

**Maneesha Yerraboina**

MSc Computer Science Graduate





