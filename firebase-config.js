// Firebase 설정 파일
// Firebase Console에서 받은 구성 정보입니다

// Firebase 구성 정보 (Firebase Console에서 복사한 정보)
const firebaseConfig = {
  apiKey: "AIzaSyAd2rKTMHt7GZzhCLHTRaGT0bgiAqXo6rA",
  authDomain: "hyundai-e653c.firebaseapp.com",
  projectId: "hyundai-e653c",
  storageBucket: "hyundai-e653c.firebasestorage.app",
  messagingSenderId: "349207208283",
  appId: "1:349207208283:web:47e15f3a387df1b1223a7e",
  measurementId: "G-K08LEVTEK5"
};

// Firebase 초기화 (Compat 버전)
firebase.initializeApp(firebaseConfig);

// Firebase 서비스 초기화
const auth = firebase.auth();
const db = firebase.firestore();

// 한국어 설정
auth.languageCode = 'ko';

console.log('✅ Firebase 초기화 완료');

