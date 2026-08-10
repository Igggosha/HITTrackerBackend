import {Body, Controller, Get, ParseIntPipe, Post, Query, Req, UseGuards} from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { JwtGuard } from '../auth/jwt.guard';
import {AuthGuard} from "@nestjs/passport";
import type { Request } from "express";

@UseGuards(JwtGuard)
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get('muscles')
  async getMuscles() {
    return this.exercisesService.getAllMuscles();
  }

  @Get()
  async getExercises() {
    return this.exercisesService.getAllExercises();
  }

    @Get("foruser")
    @UseGuards(AuthGuard("jwt"))
    async getExercisesForUser(
        @Req() req: Request,
        @Query("weekDay", ParseIntPipe) weekDay: number,
        @Query("week") week?: string,
    ) {
        return this.exercisesService.getExercisesForUser(
            req.user?.id!,
            weekDay,
            week !== undefined ? Number(week) : undefined,
        );
    }

  @Post()
  async createExercise(
    @Body() body: { name: string; videoUrl?: string; muscleIds?: number[] },
  ) {
    return this.exercisesService.createExercise(body);
  }
}