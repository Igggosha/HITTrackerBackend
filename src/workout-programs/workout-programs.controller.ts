import {Controller, Get} from "@nestjs/common";
import {AppService} from "../app.service";
import {WorkoutProgramsService} from "./workout-programs.service";

@Controller()
export class WorkoutProgramsController {
    constructor(private readonly workoutProgramsService: WorkoutProgramsService) {}

    @Get()
    async getHello(): Promise<string> {
        return await this.workoutProgramsService.getHello();
    }
}
