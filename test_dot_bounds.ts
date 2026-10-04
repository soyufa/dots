import { LevelRepository } from './src/core/levels/LevelData';
import { DifficultyLevel } from './src/types/stage';

const difficulties: DifficultyLevel[] = ['easy', 'normal', 'hard'];
let outCount = 0;
let totalDots = 0;

for (const diff of difficulties) {
  const stages = LevelRepository.getStagesByDifficulty(diff);
  for (const s of stages) {
    const board = s.board!;
    for (const d of s.dots) {
      for (const pt of [d.pointA, d.pointB]) {
        totalDots++;
        if (board.type === 'circle') {
          const distFromCenter = Math.hypot(pt.x - board.centerX, pt.y - board.centerY);
          const outerEdge = distFromCenter + d.radius;
          if (outerEdge > board.radius + 0.001) {
            console.error(
              `[원형 보드 튀어나옴!] ${s.stageId} dot(${pt.x.toFixed(3)}, ${pt.y.toFixed(3)}) r=${d.radius} outer=${outerEdge.toFixed(3)} > R=${board.radius}`
            );
            outCount++;
          }
        } else {
          const minX = pt.x - d.radius;
          const maxX = pt.x + d.radius;
          const minY = pt.y - d.radius;
          const maxY = pt.y + d.radius;
          if (
            minX < board.bounds.minX - 0.001 ||
            maxX > board.bounds.maxX + 0.001 ||
            minY < board.bounds.minY - 0.001 ||
            maxY > board.bounds.maxY + 0.001
          ) {
            console.error(
              `[사각 보드 튀어나옴!] ${s.stageId} dot(${pt.x.toFixed(3)}, ${pt.y.toFixed(3)}) r=${d.radius} bounds=[${minX.toFixed(3)}, ${maxX.toFixed(3)}, ${minY.toFixed(3)}, ${maxY.toFixed(3)}]`
            );
            outCount++;
          }
        }
      }
    }
  }
}

console.log(`총 검증된 점 수: ${totalDots}개`);
console.log(`테두리 밖으로 튀어나온 점 수: ${outCount}개`);
if (outCount === 0) {
  console.log('>>> 150개 스테이지 전수: 모든 점이 테두리 안쪽에 100% 완벽 내접! <<<');
}
