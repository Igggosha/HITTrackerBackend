import { Injectable } from '@nestjs/common';
import {Muscle} from "./entities/muscle.entity";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

@Injectable()
export class WorkoutProgramsService {

    constructor(
        @InjectRepository(Muscle)
        private readonly musclesRepo: Repository<Muscle>,
    ) {}

    async getHello(): Promise<string> {
        let count = await this.musclesRepo.count()
        return count.toString();
        // return 'Hello World!';
    }


}
