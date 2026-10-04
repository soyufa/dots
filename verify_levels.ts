import { LevelRepository } from './src/core/levels/LevelData';
import { Intersection } from './src/core/physics/Intersection';
import { DifficultyLevel } from './src/types/stage';

console.log('=== 150개 스테이지 전수 무교차 검증 시작 ===');

LevelRepository.init();

const difficulties: DifficultyLevel[] = ['easy', 'normal', 'hard'];
let totalStages = 0;
let totalIntersections = 0;
let minPathLen = Infinity;
let maxPathLen = 0;
let minDotDist = Infinity;

for (const diff of difficulties) {
  const stages = LevelRepository.getStagesByDifficulty(diff);
  console.log(`[검증 중] ${diff.toUpperCase()} 난이도 (${stages.length}개 스테이지)...`);

  for (const stage of stages) {
    totalStages++;
    const hints = stage.solutionHints ?? [];

    // 각 경로의 길이 및 점 간 거리 측정
    for (const hint of hints) {
      minPathLen = Math.min(minPathLen, hint.path.length);
      maxPathLen = Math.max(maxPathLen, hint.path.length);
      const start = hint.path[0];
      const end = hint.path[hint.path.length - 1];
      const d = Math.hypot(start.x - end.x, start.y - end.y);
      minDotDist = Math.min(minDotDist, d);
    }

    // 모든 정답 경로 쌍 간의 선분 교차 검사
    for (let i = 0; i < hints.length; i++) {
      const pathA = hints[i].path;
      for (let j = i + 1; j < hints.length; j++) {
        const pathB = hints[j].path;

        for (let sa = 0; sa < pathA.length - 1; sa++) {
          const a1 = pathA[sa];
          const a2 = pathA[sa + 1];

          for (let sb = 0; sb < pathB.length - 1; sb++) {
            const b1 = pathB[sb];
            const b2 = pathB[sb + 1];

            const intersects = Intersection.doSegmentsIntersect(a1, a2, b1, b2);
            if (intersects) {
              console.error(
                `[교차 발견!!] ${stage.stageId} - Pair ${hints[i].pairId} seg ${sa} vs Pair ${hints[j].pairId} seg ${sb}`
              );
              totalIntersections++;
            }
          }
        }
      }
    }
  }
}

console.log('\n================ 검증 결과 ================');
console.log(`검증된 총 스테이지 수: ${totalStages}`);
console.log(`발견된 교차 선분 수: ${totalIntersections} 건`);
console.log(`최소 정답 경로 점 수: ${minPathLen}, 최대 정답 경로 점 수: ${maxPathLen}`);
console.log(`최소 시작점-끝점 간 거리: ${minDotDist.toFixed(4)}`);
console.log(totalIntersections === 0 ? '>>> 100% 무결성 검증 성공 (교차 수 0건) <<<' : '>>> 검증 실패 <<<');

if (totalIntersections > 0) {
  process.exit(1);
}
