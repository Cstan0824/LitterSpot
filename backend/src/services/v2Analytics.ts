export type MinuteMetric = { sampleAttemptCount: number; successfulSampleCount: number; failedSampleCount: number; peopleSum: number; peopleMax: number; qualifyingLitterCount: number; qualifyingSpillCount: number; qualifyingBinFullCount: number; qualifyingBinOverflowCount: number; simulationSampleCount: number };

export function mergeMinuteMetric(current: MinuteMetric | undefined, incoming: MinuteMetric): MinuteMetric {
  const base = current ?? { sampleAttemptCount: 0, successfulSampleCount: 0, failedSampleCount: 0, peopleSum: 0, peopleMax: 0, qualifyingLitterCount: 0, qualifyingSpillCount: 0, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: 0, simulationSampleCount: 0 };
  return { sampleAttemptCount: base.sampleAttemptCount + incoming.sampleAttemptCount, successfulSampleCount: base.successfulSampleCount + incoming.successfulSampleCount, failedSampleCount: base.failedSampleCount + incoming.failedSampleCount, peopleSum: base.peopleSum + incoming.peopleSum, peopleMax: Math.max(base.peopleMax, incoming.peopleMax), qualifyingLitterCount: base.qualifyingLitterCount + incoming.qualifyingLitterCount, qualifyingSpillCount: base.qualifyingSpillCount + incoming.qualifyingSpillCount, qualifyingBinFullCount: base.qualifyingBinFullCount + incoming.qualifyingBinFullCount, qualifyingBinOverflowCount: base.qualifyingBinOverflowCount + incoming.qualifyingBinOverflowCount, simulationSampleCount: base.simulationSampleCount + incoming.simulationSampleCount };
}

export function equalThirdsScore(input: { peopleActivity: number; cleaningFrequency: number; binServiceFrequency: number }) {
  return ((input.peopleActivity + input.cleaningFrequency + input.binServiceFrequency) / 3) * 100;
}

export function busyZoneScore(input: { normalizedPeoplePressure: number; normalizedActiveWorkPoints: number }) { return (input.normalizedPeoplePressure * 0.5 + input.normalizedActiveWorkPoints * 0.5) * 100; }

