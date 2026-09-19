# Korea Pre-Spike Learning Radar V3

개인용 한국주식 급등 전조 학습 레이더.

## 필수 환경변수
- `RADAR_PASSWORD`: 최초 인증 비밀번호
- `SESSION_SECRET`: 32자 이상 무작위 문자열 권장

## 선택 환경변수
- `NAVER_CLIENT_ID`: 네이버 검색 API Client ID (뉴스 점수)
- `NAVER_CLIENT_SECRET`: 네이버 검색 API Client Secret

## 데이터
- 종목목록/시가총액: 네이버 금융 시장총액 페이지
- 일봉/거래량: Yahoo Finance chart endpoint
- 외국인/기관 수급: 네이버 금융 종목별 외국인 페이지
- 뉴스: 네이버 검색 API 연결 시 활성화

공시/섹터·테마 역사 데이터는 현재 MVP에서 임의 생성하지 않으며 데이터 없음으로 처리한다.
