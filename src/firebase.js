import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAQkS9cAd8_ouVlfjjkiz5bQmGlhasd22g",
  authDomain: "archive-song.firebaseapp.com",
  projectId: "archive-song",
  storageBucket: "archive-song.firebasestorage.app",
  messagingSenderId: "579627045180",
  appId: "1:579627045180:web:54506f4a011d21f6398e39",
  measurementId: "G-5PECXSHNNE"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
