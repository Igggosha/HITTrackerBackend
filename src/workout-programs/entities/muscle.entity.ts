import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Muscle {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    commonName: string; // "chest", "back"

    @Column()
    physiologicalName: string; // "pectoralis major", "latissimus dorsi"
}