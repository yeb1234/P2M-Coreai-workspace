export type ID = string;

export type ISODateString = string; // YYYY-MM-DD
export type ISODateTimeString = string; // ISO 8601
export type TimeString = string; // HH:mm

export interface Timestamps {
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
