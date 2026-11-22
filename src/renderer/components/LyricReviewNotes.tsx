import React from "react";
import { lyricCriterionMaxScore, lyricReviewCriteria, type LyricVersion } from "../../shared/lyric-writing";

const criteria = Object.keys(lyricReviewCriteria) as (keyof typeof lyricReviewCriteria)[];

export default function LyricReviewNotes({ review }: { review: NonNullable<LyricVersion["review"]> }) {
  const { rubric, findings } = review;
  return <>
    {rubric && <p className="muted">{criteria.map(key => `${lyricReviewCriteria[key]} ${rubric[key]}/${lyricCriterionMaxScore}`).join(" · ")}</p>}
    <ul>{findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>
  </>;
}
