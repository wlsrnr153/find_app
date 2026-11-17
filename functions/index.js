/**
 * Firebase Cloud Functions
 * - Custom Claims를 사용하여 Firestore Rules 읽기 횟수 최적화
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const vision = require('@google-cloud/vision');

admin.initializeApp();

/** Vision 클라이언트 재사용 */
let visionClient = null;
function getVisionClient() {
  if (!visionClient) {
    visionClient = new vision.ImageAnnotatorClient();
  }
  return visionClient;
}

function stripImageBase64(raw) {
  const s = String(raw || '').trim();
  const comma = s.indexOf('base64,');
  if (comma >= 0) return s.slice(comma + 'base64,'.length);
  return s;
}

/**
 * 사용자 역할 설정 함수 (관리자만 호출 가능)
 * Custom Claims에 role을 저장하여 Firestore Rules에서 추가 읽기 없이 역할 확인
 */
exports.setUserRole = functions.https.onCall(async (data, context) => {
  // 인증 확인
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다');
  }
  
  const callerUid = context.auth.uid;
  
  try {
    // 호출자의 역할 확인 (Firestore에서)
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    
    if (!callerDoc.exists) {
      throw new functions.https.HttpsError('not-found', '사용자 정보를 찾을 수 없습니다');
    }
    
    const callerRole = callerDoc.data().role;
    
    // 관리자만 역할 변경 가능
    if (callerRole !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다');
    }
    
    const { userId, role } = data;
    
    // 유효성 검사
    if (!userId || !role) {
      throw new functions.https.HttpsError('invalid-argument', 'userId와 role이 필요합니다');
    }
    
    if (role !== 'admin' && role !== 'user') {
      throw new functions.https.HttpsError('invalid-argument', 'role은 "admin" 또는 "user"여야 합니다');
    }
    
    // Custom Claims 설정
    await admin.auth().setCustomUserClaims(userId, { role });
    
    // Firestore도 업데이트
    await admin.firestore().collection('users').doc(userId).update({ 
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ 사용자 ${userId}의 역할을 ${role}로 설정`);
    
    return { 
      success: true, 
      message: `역할이 ${role}로 변경되었습니다`,
      userId,
      role
    };
    
  } catch (error) {
    console.error('역할 설정 오류:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', '역할 설정 중 오류가 발생했습니다');
  }
});

/**
 * 신규 사용자 생성 시 자동으로 Custom Claims 설정
 * 첫 번째 사용자는 관리자, 나머지는 일반 사용자
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  try {
    console.log(`🆕 신규 사용자 생성: ${user.email} (UID: ${user.uid})`);
    
    // 기존 사용자 수 확인 (첫 사용자인지 체크)
    const usersSnapshot = await admin.firestore().collection('users').limit(1).get();
    const isFirstUser = usersSnapshot.empty;
    
    const role = isFirstUser ? 'admin' : 'user';
    
    console.log(`👤 첫 번째 사용자: ${isFirstUser}, 역할: ${role}`);
    
    // Custom Claims 설정
    await admin.auth().setCustomUserClaims(user.uid, { role });
    console.log(`✅ Custom Claims 설정 완료: ${role}`);
    
    // Firestore에 사용자 정보 저장
    await admin.firestore().collection('users').doc(user.uid).set({
      email: user.email,
      displayName: user.displayName || user.email,
      role: role,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Firestore에 사용자 정보 저장 완료`);
    
    if (isFirstUser) {
      console.log('🎉 첫 번째 사용자로 관리자 권한이 부여되었습니다');
    }
    
    return null;
    
  } catch (error) {
    console.error('신규 사용자 처리 오류:', error);
    // 오류가 발생해도 사용자 생성 자체는 실패하지 않도록 함
    return null;
  }
});

/**
 * 사용자 본인의 Custom Claims 동기화 (자동 마이그레이션)
 * 모든 로그인한 사용자가 본인의 Custom Claims를 동기화할 수 있음
 */
exports.syncMyCustomClaims = functions.https.onCall(async (data, context) => {
  // 인증 확인
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다');
  }
  
  const userId = context.auth.uid;
  
  try {
    // Firestore에서 사용자 역할 확인
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', '사용자 정보를 찾을 수 없습니다');
    }
    
    const role = userDoc.data().role || 'user';
    
    // Custom Claims 설정
    await admin.auth().setCustomUserClaims(userId, { role });
    
    console.log(`✅ Custom Claims 동기화 완료: ${userId} (${role})`);
    
    return {
      success: true,
      role: role,
      message: 'Custom Claims가 동기화되었습니다'
    };
    
  } catch (error) {
    console.error('Custom Claims 동기화 오류:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', 'Custom Claims 동기화 중 오류가 발생했습니다');
  }
});

/**
 * RFID 인쇄 태그 사진 → 클라우드 OCR (Google Cloud Vision)
 * 클라이언트는 base64 이미지만 보내고, API 키는 Functions 서비스 계정으로 처리
 *
 * 사전 준비:
 * 1) GCP에서 Cloud Vision API 사용 설정
 * 2) firebase deploy --only functions:ocrAssetTagImage
 */
exports.ocrAssetTagImage = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '512MB'
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다');
    }

    const imageBase64 = stripImageBase64(data?.imageBase64 || data?.image || '');
    if (!imageBase64) {
      throw new functions.https.HttpsError('invalid-argument', '이미지 데이터가 없습니다');
    }
    // Callable 한도(~10MB) 여유 — 대략 base64 6MB ≈ 원본 4.5MB
    if (imageBase64.length > 6_000_000) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '이미지가 너무 큽니다. 해상도를 낮추거나 한 장씩 올려 주세요.'
      );
    }

    try {
      const client = getVisionClient();
      const request = {
        image: {
          content: Buffer.from(imageBase64, 'base64')
        },
        imageContext: {
          languageHints: ['ko', 'en']
        }
      };

      // 문서·표 형태 태그에 DOCUMENT_TEXT_DETECTION이 더 적합
      const [result] = await client.documentTextDetection(request);
      const text =
        result?.fullTextAnnotation?.text
        || result?.textAnnotations?.[0]?.description
        || '';

      if (result?.error?.message) {
        throw new Error(result.error.message);
      }

      return {
        success: true,
        text: String(text || ''),
        // 참고용 — Vision은 페이지 단위 신뢰도를 항상 주지 않음
        pages: result?.fullTextAnnotation?.pages?.length || 0
      };
    } catch (error) {
      console.error('ocrAssetTagImage 오류:', error);

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      const msg = String(error?.message || error || '');
      if (/PERMISSION_DENIED|Vision API has not been used|API has not been enabled/i.test(msg)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Cloud Vision API가 프로젝트에서 사용 설정되지 않았습니다. GCP 콘솔에서 Vision API를 켜 주세요.'
        );
      }

      throw new functions.https.HttpsError(
        'internal',
        msg.slice(0, 180) || '클라우드 OCR 처리 중 오류가 발생했습니다'
      );
    }
  });

/**
 * 기존 사용자의 Custom Claims 마이그레이션 (일회성 실행용)
 * 호출 방법: Firebase Console의 Functions 탭에서 수동 호출
 */
exports.migrateExistingUsers = functions.https.onCall(async (data, context) => {
  // 관리자만 호출 가능
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다');
  }
  
  const callerUid = context.auth.uid;
  
  try {
    // 호출자가 관리자인지 확인
    const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
    
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', '관리자 권한이 필요합니다');
    }
    
    console.log('🔄 기존 사용자 마이그레이션 시작...');
    
    // 모든 사용자 문서 가져오기
    const usersSnapshot = await admin.firestore().collection('users').get();
    
    let migratedCount = 0;
    const errors = [];
    
    // 각 사용자에 대해 Custom Claims 설정
    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = userDoc.data();
        const userId = userDoc.id;
        const role = userData.role || 'user';
        
        // Custom Claims 설정
        await admin.auth().setCustomUserClaims(userId, { role });
        
        console.log(`✅ 마이그레이션: ${userId} (${role})`);
        migratedCount++;
        
      } catch (error) {
        console.error(`❌ 마이그레이션 실패: ${userDoc.id}`, error);
        errors.push({ userId: userDoc.id, error: error.message });
      }
    }
    
    console.log(`🎉 마이그레이션 완료: ${migratedCount}명 성공`);
    
    return {
      success: true,
      migratedCount,
      totalUsers: usersSnapshot.size,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error('마이그레이션 오류:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', '마이그레이션 중 오류가 발생했습니다');
  }
});






