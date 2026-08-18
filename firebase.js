import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC4GyboQgeYdNxwDyxkEowpXTsAT-CMFyg",
    authDomain: "production-b0b2c.firebaseapp.com",
    databaseURL: "https://production-b0b2c-default-rtdb.firebaseio.com",
    projectId: "production-b0b2c",
    storageBucket: "production-b0b2c.firebasestorage.app",
    messagingSenderId: "628405148231",
    appId: "1:628405148231:web:e277a8422324e358aaef62",
    measurementId: "G-5KP3JMH9EZ"
};


const app = initializeApp(firebaseConfig);
const adminProvisioningApp = initializeApp(firebaseConfig, 'admin-provisioning');

const auth = getAuth(app);
const adminProvisioningAuth = getAuth(adminProvisioningApp);

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});
const storage = getStorage(app);

export { db, storage, auth, adminProvisioningAuth, firebaseConfig };
